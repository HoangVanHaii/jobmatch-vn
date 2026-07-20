import Anthropic from '@anthropic-ai/sdk';
import type { LLMProvider, ChatMessage, ChatOptions, ChatResponse, EmbeddingResponse } from './base';

export class AnthropicProvider implements LLMProvider {
  readonly name = 'anthropic';
  readonly model: string;
  private client: Anthropic;

  constructor(model: string) {
    this.model = model;
    this.client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }

  async chat(messages: ChatMessage[], options: ChatOptions = {}): Promise<ChatResponse> {
    const system = messages.find((m) => m.role === 'system')?.content;
    const rest = messages.filter((m) => m.role !== 'system');
    const res = await this.client.messages.create({
      model: this.model,
      max_tokens: options.maxTokens ?? 1024,
      system,
      messages: rest.map((m) => ({ role: m.role as any, content: m.content })),
    });
    const text = res.content[0].type === 'text' ? res.content[0].text : '';
    return {
      content: text,
      usage: {
        promptTokens: res.usage.input_tokens,
        completionTokens: res.usage.output_tokens,
        totalTokens: res.usage.input_tokens + res.usage.output_tokens,
      },
      costUsd: 0,
    };
  }

  async *streamChat(messages: ChatMessage[], options: ChatOptions = {}): AsyncIterable<string> {
    const system = messages.find((m) => m.role === 'system')?.content;
    const rest = messages.filter((m) => m.role !== 'system');
    const stream = await this.client.messages.stream({
      model: this.model,
      max_tokens: options.maxTokens ?? 1024,
      system,
      messages: rest.map((m) => ({ role: m.role as any, content: m.content })),
    });
    for await (const chunk of stream) {
      if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') yield chunk.delta.text;
    }
  }

  async embed(_text: string | string[]): Promise<EmbeddingResponse | EmbeddingResponse[]> {
    throw new Error('Anthropic does not provide embeddings — use OpenAI');
  }
}