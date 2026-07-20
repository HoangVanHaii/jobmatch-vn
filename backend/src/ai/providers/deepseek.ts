import OpenAI from 'openai';
import type { LLMProvider, ChatMessage, ChatOptions, ChatResponse, EmbeddingResponse } from './base';

/**
 * DeepSeek dùng OpenAI-compatible API
 * Docs: https://platform.deepseek.com/docs
 */
export class DeepSeekProvider implements LLMProvider {
  readonly name = 'deepseek';
  readonly model: string;
  private client: OpenAI;

  constructor(model: string) {
    this.model = model;
    this.client = new OpenAI({
      apiKey: process.env.DEEPSEEK_API_KEY,
      baseURL: 'https://api.deepseek.com',
    });
  }

  async chat(messages: ChatMessage[], options: ChatOptions = {}): Promise<ChatResponse> {
    const res = await this.client.chat.completions.create({
      model: this.model,
      messages: messages as any,
      temperature: options.temperature ?? 0.7,
      max_tokens: options.maxTokens,
    });
    return {
      content: res.choices[0].message.content ?? '',
      usage: {
        promptTokens: res.usage?.prompt_tokens ?? 0,
        completionTokens: res.usage?.completion_tokens ?? 0,
        totalTokens: res.usage?.total_tokens ?? 0,
      },
      costUsd: ((res.usage?.total_tokens ?? 0) / 1_000_000) * 0.14,
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
      yield chunk.choices[0]?.delta?.content ?? '';
    }
  }

  async embed(_text: string | string[]): Promise<EmbeddingResponse | EmbeddingResponse[]> {
    throw new Error('DeepSeek does not provide embeddings — use OpenAI/multilingual-e5');
  }
}