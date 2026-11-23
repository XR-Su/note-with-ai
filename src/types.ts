export type Mode = 'daily' | 'memory';
export type Provider = 'deepseek' | 'minimax';
export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  english?: string;
  explanation?: string;
  translation?: boolean;
  chinese?: string;
}
export interface Entry {
  id: string;
  mode: Mode;
  date: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  archived: boolean;
  summary: string;
  draft: string;
  messages: Message[];
}
export interface Settings {
  provider: Provider;
  memoryDays: number;
  rememberKeys: boolean;
  keys: Record<Provider, string>;
}
export interface ArchivedContext {
  date: string;
  title: string;
  summary: string;
}
export type AIAction = 'chat' | 'correct' | 'archive';
export interface AIResult {
  english: string;
  explanation: string;
  translation: boolean;
  question: string;
  chinese: string;
  title: string;
  summary: string;
}
