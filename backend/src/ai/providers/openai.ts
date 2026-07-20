import OpenAI from 'openai';
import type { LLMProvider, ChatMessage, ChatOptions, ChatResponse, EmbeddingResponse } from './base';

export class OpenAIProvider implements LLMProvider {
  readonly name = 'openai';
  readonly model: string;
  private client: OpenAI;

  constructor(model: string) {
    this.model = model;
    this.client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }

  async chat(messages: ChatMessage[], options: ChatOptions = {}): Promise<ChatResponse> {
    const res = await this.client.chat.completions.create({
      model: this.model,
      messages: messages.map((m) => ({ role: m.role, content: m.content, name: m.name, tool_call_id: m.toolCallId })) as any,
      temperature: options.temperature ?? 0.7,
      max_tokens: options.maxTokens,
      tools: options.tools as any,
    });
    const choice = res.choices[0];
    return {
      content: choice.message.content ?? '',
      toolCalls: (choice.message.tool_calls ?? []).map((tc: any) => ({
        name: tc.function.name,
        arguments: JSON.parse(tc.function.arguments),
      })),
      usage: {
        promptTokens: res.usage?.prompt_tokens ?? 0,
        completionTokens: res.usage?.completion_tokens ?? 0,
        totalTokens: res.usage?.total_tokens ?? 0,
      },
      costUsd: this.estimateCost(res.usage?.total_tokens ?? 0),
    };
  }

  async *streamChat(messages: ChatMessage[], options: ChatOptions = {}): AsyncIterable<string> {
    const stream = await this.client.chat.completions.create({
      model: this.model,
      messages: messages as any,
      temperature: options.temperature ?? 0.7,
      stream: true,
    });
    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content ?? '';
      if (delta) yield delta;
    }
  }

  async embed(text: string | string[]): Promise<EmbeddingResponse | EmbeddingResponse[]> {
    const inputs = Array.isArray(text) ? text : [text];
    const res = await this.client.embeddings.create({ model: this.model, input: inputs });
    if (!Array.isArray(text)) {
      const e = res.data[0];
      return { vector: e.embedding, model: this.model, usage: { totalTokens: res.usage.total_tokens }, costUsd: 0 };
    }
    return res.data.map((e, i) => ({
      vector: e.embedding,
      model: this.model,
      usage: { totalTokens: Math.floor(res.usage.total_tokens / res.data.length) },
      costUsd: 0,
    }));
  }

  private estimateCost(tokens: number): number {
    // gpt-4o-mini: $0.15/1M in, $0.6/1M out — đơn giản hoá
    return (tokens / 1_000_000) * 0.3;
  }
}