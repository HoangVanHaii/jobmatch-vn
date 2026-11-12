/**
 * Google Calendar Integration Service
 * Xử lý OAuth authorization, lưu trữ token mã hóa, kiểm tra trạng thái và đồng bộ
 */
import { OAuth2Client } from 'google-auth-library';
import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';
import jwt from 'jsonwebtoken';
import { db } from '../config/database';
import { userCalendarIntegrations } from '../db/schema/interview';
import { users } from '../db/schema/users';
import { eq, and, or } from 'drizzle-orm';
import { env } from '../config/env';
import { encrypt, decrypt } from '../config/crypto';
import { AppError } from '../middleware/errorHandler';
import { logger } from '../config/logger';

const getOAuth2Client = (): OAuth2Client => {
  return new OAuth2Client(
    env.GOOGLE_CLIENT_ID,
    env.GOOGLE_CLIENT_SECRET,
    env.GOOGLE_CALENDAR_CALLBACK_URL || 'http://localhost:5000/api/v1/interviews/calendar/callback'
  );
};

export const googleCalendarService = {
  /**
   * Sinh URL để HR chuyển hướng tới Google cấp quyền
   */
  getConnectUrl: (userId: string, returnTo?: string): string => {
    if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
      throw new AppError(500, 'GOOGLE_CONFIG_MISSING', 'Google Client ID hoặc Secret chưa được cấu hình.');
    }

    // Ký state bằng JWT với TTL 15 phút chống giả mạo / CSRF
    const state = jwt.sign(
      { userId, action: 'connect_google_calendar', returnTo },
      env.JWT_ACCESS_SECRET,
      { expiresIn: '15m' }
    );

    const client = getOAuth2Client();
    return client.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent', // Luôn yêu cầu consent để đảm bảo nhận được refresh_token
      scope: [
        'https://www.googleapis.com/auth/calendar.events',
        'https://www.googleapis.com/auth/calendar.readonly',
        'https://www.googleapis.com/auth/userinfo.email',
      ],
      state,
    });
  },

  /**
   * Xử lý callback khi Google redirect về với code & state
   */
  handleCallback: async (code: string, state: string): Promise<{ userId: string; calendarEmail?: string; returnTo?: string }> => {
    let payload: { userId?: string; action?: string; returnTo?: string };
    try {
      payload = jwt.verify(state, env.JWT_ACCESS_SECRET) as { userId?: string; action?: string; returnTo?: string };
    } catch {
      throw new AppError(400, 'INVALID_STATE', 'Trạng thái xác thực không hợp lệ hoặc phiên đã hết hạn. Vui lòng thử lại.');
    }

    if (payload.action !== 'connect_google_calendar' || !payload.userId) {
      throw new AppError(400, 'INVALID_STATE', 'Trạng thái xác thực không hợp lệ.');
    }

    const userId = payload.userId;
    const client = getOAuth2Client();

    let tokens;
    try {
      const response = await client.getToken({
        code,
        redirect_uri: env.GOOGLE_CALENDAR_CALLBACK_URL || 'http://localhost:5000/api/v1/interviews/calendar/callback',
      });
      tokens = response.tokens;
    } catch (err: any) {
      logger.error({ err, userId }, 'Google calendar exchange token failed');
      throw new AppError(502, 'GOOGLE_TOKEN_EXCHANGE_FAILED', 'Không thể đổi mã xác thực với Google. Vui lòng thử lại.');
    }

    // Tìm xem user đã từng liên kết chưa để fallback refresh_token nếu Google không cấp lại
    const [existing] = await db
      .select()
      .from(userCalendarIntegrations)
      .where(and(eq(userCalendarIntegrations.userId, userId), eq(userCalendarIntegrations.provider, 'google')))
      .limit(1);

    if (!tokens.refresh_token && !existing?.refreshTokenEncrypted) {
      throw new AppError(400, 'NO_REFRESH_TOKEN', 'Google không cấp quyền truy cập dài hạn (refresh token). Vui lòng thử lại và chọn chấp nhận mọi quyền.');
    }

    // Lấy email Google
    let calendarEmail: string | undefined;
    if (tokens.id_token) {
      try {
        const ticket = await client.verifyIdToken({
          idToken: tokens.id_token,
          audience: env.GOOGLE_CLIENT_ID,
        });
        calendarEmail = ticket.getPayload()?.email;
      } catch {
        // Fallback
      }
    }

    if (!calendarEmail && tokens.access_token) {
      try {
        client.setCredentials(tokens);
        const userInfoRes = await client.request<{ email?: string }>({
          url: 'https://www.googleapis.com/oauth2/v2/userinfo',
        });
        calendarEmail = userInfoRes.data.email;
      } catch {
        // Fallback
      }
    }

    const refreshTokenToSave = tokens.refresh_token
      ? encrypt(tokens.refresh_token)
      : existing!.refreshTokenEncrypted;

    const accessTokenToSave = tokens.access_token ? encrypt(tokens.access_token) : null;

    await db
      .insert(userCalendarIntegrations)
      .values({
        userId,
        provider: 'google',
        calendarEmail: calendarEmail ?? null,
        accessTokenEncrypted: accessTokenToSave,
        refreshTokenEncrypted: refreshTokenToSave,
        tokenExpiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
        scope: tokens.scope ?? null,
        isConnected: true,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [userCalendarIntegrations.userId, userCalendarIntegrations.provider],
        set: {
          calendarEmail: calendarEmail ?? existing?.calendarEmail ?? null,
          accessTokenEncrypted: accessTokenToSave,
          refreshTokenEncrypted: refreshTokenToSave,
          tokenExpiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
          scope: tokens.scope ?? existing?.scope ?? null,
          isConnected: true,
          updatedAt: new Date(),
        },
      });

    return { userId, calendarEmail, returnTo: payload.returnTo };
  },

  /**
   * Lấy trạng thái kết nối Google Calendar của HR
   */
  getStatus: async (userId: string): Promise<{ isConnected: boolean; provider?: string; calendarEmail?: string | null; connectedAt?: Date }> => {
    const [row] = await db
      .select({
        id: userCalendarIntegrations.id,
        provider: userCalendarIntegrations.provider,
        calendarEmail: userCalendarIntegrations.calendarEmail,
        isConnected: userCalendarIntegrations.isConnected,
        createdAt: userCalendarIntegrations.createdAt,
      })
      .from(userCalendarIntegrations)
      .where(and(eq(userCalendarIntegrations.userId, userId), eq(userCalendarIntegrations.provider, 'google')))
      .limit(1);

    if (!row || !row.isConnected) {
      return { isConnected: false };
    }

    return {
      isConnected: true,
      provider: row.provider,
      calendarEmail: row.calendarEmail,
      connectedAt: row.createdAt,
    };
  },

  /**
   * Ngắt kết nối Google Calendar
   */
  disconnect: async (userId: string): Promise<void> => {
    await db
      .update(userCalendarIntegrations)
      .set({ isConnected: false, updatedAt: new Date() })
      .where(and(eq(userCalendarIntegrations.userId, userId), eq(userCalendarIntegrations.provider, 'google')));
  },

  /**
   * Lấy OAuth2Client đã được gán credentials giải mã của user để gọi Google Calendar API
   */
  getAuthenticatedClient: async (userId: string): Promise<OAuth2Client | null> => {
    const [row] = await db
      .select()
      .from(userCalendarIntegrations)
      .where(and(eq(userCalendarIntegrations.userId, userId), eq(userCalendarIntegrations.provider, 'google'), eq(userCalendarIntegrations.isConnected, true)))
      .limit(1);

    if (!row) return null;

    const refreshToken = decrypt(row.refreshTokenEncrypted);
    const client = getOAuth2Client();
    client.setCredentials({
      refresh_token: refreshToken,
      access_token: row.accessTokenEncrypted ? decrypt(row.accessTokenEncrypted) : undefined,
      expiry_date: row.tokenExpiresAt ? row.tokenExpiresAt.getTime() : undefined,
    });

    return client;
  },

  /**
   * Tạo sự kiện phỏng vấn trên Google Calendar + sinh link Google Meet tự động
   */
  createEvent: async (params: {
    userId: string;
    summary: string;
    description?: string;
    location?: string;
    scheduledAt: Date;
    durationMin: number;
    attendeeEmail?: string;
    interviewerEmail?: string;
    createMeet?: boolean;
  }): Promise<{ eventId: string; meetingLink: string | null; htmlLink?: string } | null> => {
    try {
      const client = await googleCalendarService.getAuthenticatedClient(params.userId);
      if (!client) return null;

      const tokenRes = await client.getAccessToken();
      const accessToken = tokenRes.token;
      if (!accessToken) return null;

      const startIso = params.scheduledAt.toISOString();
      const endIso = new Date(params.scheduledAt.getTime() + params.durationMin * 60 * 1000).toISOString();

      const attendeesList: Array<{ email: string }> = [];
      if (params.attendeeEmail) {
        attendeesList.push({ email: params.attendeeEmail });
      }
      if (params.interviewerEmail && params.interviewerEmail !== params.attendeeEmail) {
        attendeesList.push({ email: params.interviewerEmail });
      }

      const requestBody: Record<string, unknown> = {
        summary: params.summary,
        description: params.description ?? '',
        location: params.location ?? '',
        start: { dateTime: startIso },
        end: { dateTime: endIso },
        attendees: attendeesList,
      };

      if (params.createMeet !== false) {
        requestBody.conferenceData = {
          createRequest: {
            requestId: uuidv4(),
            conferenceSolutionKey: { type: 'hangoutsMeet' },
          },
        };
      }

      const res = await axios.post<{
        id: string;
        hangoutLink?: string;
        htmlLink?: string;
        conferenceData?: {
          entryPoints?: Array<{ entryPointType: string; uri: string }>;
        };
      }>(
        'https://www.googleapis.com/calendar/v3/calendars/primary/events?conferenceDataVersion=1',
        requestBody,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
        },
      );

      const meetingLink =
        res.data.hangoutLink ??
        res.data.conferenceData?.entryPoints?.find((e) => e.entryPointType === 'video')?.uri ??
        null;

      return {
        eventId: res.data.id,
        meetingLink,
        htmlLink: res.data.htmlLink,
      };
    } catch (err) {
      logger.error({ err, userId: params.userId }, 'googleCalendarService.createEvent failed');
      return null;
    }
  },

  /**
   * Cập nhật thời gian hoặc nội dung sự kiện trên Google Calendar
   */
  updateEvent: async (params: {
    userId: string;
    eventId: string;
    summary?: string;
    description?: string;
    location?: string;
    scheduledAt?: Date;
    durationMin?: number;
  }): Promise<boolean> => {
    try {
      const client = await googleCalendarService.getAuthenticatedClient(params.userId);
      if (!client) return false;

      const tokenRes = await client.getAccessToken();
      const accessToken = tokenRes.token;
      if (!accessToken) return false;

      const patchBody: Record<string, unknown> = {};
      if (params.summary) patchBody.summary = params.summary;
      if (params.description !== undefined) patchBody.description = params.description;
      if (params.location !== undefined) patchBody.location = params.location;
      if (params.scheduledAt && params.durationMin) {
        patchBody.start = { dateTime: params.scheduledAt.toISOString() };
        patchBody.end = {
          dateTime: new Date(params.scheduledAt.getTime() + params.durationMin * 60 * 1000).toISOString(),
        };
      }

      await axios.patch(
        `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(params.eventId)}`,
        patchBody,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
        },
      );
      return true;
    } catch (err) {
      logger.error({ err, userId: params.userId, eventId: params.eventId }, 'googleCalendarService.updateEvent failed');
      return false;
    }
  },

  /**
   * Huỷ / Xoá sự kiện trên Google Calendar
   */
  deleteEvent: async (params: { userId: string; eventId: string }): Promise<boolean> => {
    try {
      const client = await googleCalendarService.getAuthenticatedClient(params.userId);
      if (!client) return false;

      const tokenRes = await client.getAccessToken();
      const accessToken = tokenRes.token;
      if (!accessToken) return false;

      await axios.delete(
        `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(params.eventId)}?sendUpdates=all`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        },
      );
      return true;
    } catch (err) {
      logger.error({ err, userId: params.userId, eventId: params.eventId }, 'googleCalendarService.deleteEvent failed');
      return false;
    }
  },

  /**
   * Lấy danh sách khung giờ bận trong ngày của người phỏng vấn hoặc HR (Google Calendar FreeBusy query)
   */
  getBusyTimes: async (params: {
    userId: string;
    timeMin: Date;
    timeMax: Date;
    targetEmail?: string;
  }): Promise<Array<{ start: string; end: string }>> => {
    try {
      let client = await googleCalendarService.getAuthenticatedClient(params.userId);

      const target = params.targetEmail?.trim();
      const isTargetSpecified = Boolean(target && target.toLowerCase() !== 'primary');

      let queryId = 'primary';

      if (isTargetSpecified) {
        // 1. Kiểm tra xem targetEmail có tài khoản kết nối Google Calendar trong hệ thống không
        const [targetIntegration] = await db
          .select({
            userId: userCalendarIntegrations.userId,
            calendarEmail: userCalendarIntegrations.calendarEmail,
          })
          .from(userCalendarIntegrations)
          .leftJoin(users, eq(userCalendarIntegrations.userId, users.id))
          .where(
            and(
              or(
                eq(userCalendarIntegrations.calendarEmail, target!),
                eq(users.email, target!),
              ),
              eq(userCalendarIntegrations.provider, 'google'),
              eq(userCalendarIntegrations.isConnected, true),
            ),
          )
          .limit(1);

        if (targetIntegration) {
          // Nếu người này đã kết nối calendar trong JobMatch VN, dùng chính client của họ -> đọc chính xác 100%
          const targetClient = await googleCalendarService.getAuthenticatedClient(targetIntegration.userId);
          if (targetClient) {
            client = targetClient;
            queryId = 'primary';
          } else {
            queryId = target!;
          }
        } else {
          // Nếu không có token riêng, dùng client của HR để query lịch bận của targetEmail
          queryId = target!;
        }
      }

      if (!client) return [];

      const tokenRes = await client.getAccessToken();
      const accessToken = tokenRes.token;
      if (!accessToken) return [];

      // CHỈ query đúng calendar cần kiểm tra (không gộp cứng 'primary' của HR vào khi xem người khác)
      const items: Array<{ id: string }> = [{ id: queryId }];

      const res = await axios.post<{
        calendars?: Record<
          string,
          {
            busy?: Array<{ start: string; end: string }>;
            errors?: Array<{ domain?: string; reason?: string }>;
          }
        >;
      }>(
        'https://www.googleapis.com/calendar/v3/freeBusy',
        {
          timeMin: params.timeMin.toISOString(),
          timeMax: params.timeMax.toISOString(),
          items,
        },
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
        },
      );

      const calendarData = res.data?.calendars
        ? res.data.calendars[queryId] ||
          Object.entries(res.data.calendars).find(
            ([key]) => key.toLowerCase() === queryId.toLowerCase(),
          )?.[1]
        : undefined;

      if (calendarData?.errors && calendarData.errors.length > 0) {
        logger.warn(
          { userId: params.userId, queryId, errors: calendarData.errors },
          'googleCalendarService.getBusyTimes: Google returned errors (calendar may not be shared or accessible)',
        );
      }

      return calendarData?.busy ?? [];
    } catch (err) {
      logger.error({ err, userId: params.userId }, 'googleCalendarService.getBusyTimes failed');
      return [];
    }
  },
};
