/**
 * LLM Provider interface — abstraction cho multi-provider
 */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  toolCallId?: string;
  name?: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ChatOptions {
  temperature?: number;
  maxTokens?: number;
  tools?: ToolDefinition[];
  stop?: string[];
}

export interface ToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

export interface ChatResponse {
  content: string;
  toolCalls?: ToolCall[];
  usage: { promptTokens: number; completionTokens: number; totalTokens: number };
  costUsd: number;
}

export interface EmbeddingResponse {
  vector: number[];
  model: string;
  usage: { totalTokens: number };
  costUsd: number;
}

export interface LLMProvider {
  readonly name: string;
  readonly model: string;
  chat(messages: ChatMessage[], options?: ChatOptions): Promise<ChatResponse>;
  streamChat(messages: ChatMessage[], options?: ChatOptions): AsyncIterable<string>;
  embed(text: string | string[]): Promise<EmbeddingResponse | EmbeddingResponse[]>;
}