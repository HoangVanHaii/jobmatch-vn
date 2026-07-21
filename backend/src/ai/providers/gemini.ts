import { GoogleGenerativeAI } from '@google/generative-ai';
import type { LLMProvider, ChatMessage, ChatOptions, ChatResponse, EmbeddingResponse } from './base';

export class GeminiProvider implements LLMProvider {
  readonly name = 'gemini';
  readonly model: string;
  private client: GoogleGenerativeAI;

  constructor(model: string) {
    this.model = model;
    this.client = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
  }

  async chat(messages: ChatMessage[], options: ChatOptions = {}): Promise<ChatResponse> {
    const model = this.client.getGenerativeModel({ model: this.model });
    const systemInstruction = messages.find((m) => m.role === 'system')?.content;
    const history = messages.filter((m) => m.role !== 'system').map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));

    const chat = model.startChat({
      systemInstruction,
      generationConfig: { temperature: options.temperature ?? 0.7, maxOutputTokens: options.maxTokens },
    });
    const last = history.pop();
    const result = await chat.sendMessage(last!.parts[0].text);
    const text = result.response.text();

    return {
      content: text,
      usage: {
        promptTokens: result.response.usageMetadata?.promptTokenCount ?? 0,
        completionTokens: result.response.usageMetadata?.candidatesTokenCount ?? 0,
        totalTokens: result.response.usageMetadata?.totalTokenCount ?? 0,
      },
      costUsd: 0,
    };
  }

  async *streamChat(messages: ChatMessage[], options: ChatOptions = {}): AsyncIterable<string> {
    const model = this.client.getGenerativeModel({ model: this.model });
    const last = messages[messages.length - 1];
    const result = await model.generateContentStream({
      contents: [{ role: 'user', parts: [{ text: last.content }] }],
      generationConfig: { temperature: options.temperature ?? 0.7 },
    });
    for await (const chunk of result.stream) yield chunk.text();
  }

  async embed(text: string | string[]): Promise<EmbeddingResponse | EmbeddingResponse[]> {
    const model = this.client.getGenerativeModel({ model: this.model });
    const inputs = Array.isArray(text) ? text : [text];
    const result = await model.batchEmbedContents({
      requests: inputs.map((t) => ({
        content: { role: 'user', parts: [{ text: t }] },
      })),
    });
    if (!Array.isArray(text)) {
      const e = result.embeddings[0];
      return { vector: e.values, model: this.model, usage: { totalTokens: 0 }, costUsd: 0 };
    }
    return result.embeddings.map((e) => ({ vector: e.values, model: this.model, usage: { totalTokens: 0 }, costUsd: 0 }));
  }
}