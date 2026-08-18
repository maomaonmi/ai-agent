export type ThesisTargetWords = 3000 | 5000 | 8000 | 10000 | 15000 | 20000 | 30000;
export type ThesisChapterLength = 'short' | 'medium' | 'long';

export interface ThesisOutlineSection {
  id: string;
  chapterId: string;
  order: number;
  title: string;
  writingBrief: string;
  targetWords: number;
}

export interface ThesisReference {
  id: string;
  chapterId: string;
  title: string;
  url: string;
  domain: string;
  snippet: string;
  status: 'found' | 'scraped' | 'verified' | 'failed';
}

export interface ThesisOutlineChapter {
  id: string;
  order: number;
  title: string;
  summary: string;
  baseTargetWords: number;
  targetWords: number;
  length: ThesisChapterLength;
  sections: ThesisOutlineSection[];
  references: ThesisReference[];
  status: 'streaming' | 'complete' | 'failed';
  searchStatus: 'idle' | 'searching' | 'complete' | 'failed';
  searchError: string;
}

export interface ThesisOutlineState {
  title: string;
  prefaces: Array<{ id: string; title: string; writingBrief: string }>;
  chapters: ThesisOutlineChapter[];
  rawStream: string;
  targetWords: ThesisTargetWords | null;
  status: 'idle' | 'generating' | 'ready' | 'failed';
  error: string;
  researchPhase: '' | 'ResearchPlanning' | 'WebResearch' | 'KeepAlive' | 'answer';
}

export const EMPTY_THESIS_OUTLINE: ThesisOutlineState = {
  title: '',
  prefaces: [],
  chapters: [],
  rawStream: '',
  targetWords: null,
  status: 'idle',
  error: '',
  researchPhase: '',
};

export type ThesisOutlineEvent =
  | { type: 'reset' }
  | { type: 'thesis_outline_started'; target_words?: ThesisTargetWords | null }
  | { type: 'token'; token: string }
  | { type: 'title'; title: string }
  | { type: 'preface'; id: string; title: string; writing_brief?: string }
  | { type: 'chapter'; id: string; order: number; title: string; summary?: string; target_words?: number }
  | { type: 'section'; chapter_id: string; id: string; order: number; title: string; writing_brief?: string; target_words?: number }
  | { type: 'chapter_length'; chapter_id: string; length: ThesisChapterLength }
  | { type: 'chapter_deleted'; chapter_id: string }
  | { type: 'chapter_search_started'; chapter_id: string }
  | { type: 'research_phase'; phase: ThesisOutlineState['researchPhase']; status?: string }
  | { type: 'reference_found'; id: string; chapter_id: string; title: string; url: string; domain: string; snippet: string; status: ThesisReference['status'] }
  | { type: 'reference_scraped'; id: string; chapter_id: string; url: string; evidence: string; status: 'scraped' }
  | { type: 'chapter_search_completed'; chapter_id: string; count?: number }
  | { type: 'chapter_search_failed'; chapter_id: string; message?: string }
  | { type: 'done' }
  | { type: 'error'; message: string };

export type ThesisBodyEvent =
  | { type: 'body_started' }
  | { type: 'body_chapter_started'; chapter_id: string }
  | { type: 'body_token'; chapter_id: string; token: string }
  | { type: 'body_citation'; chapter_id: string; reference_id: string }
  | { type: 'body_verification_started'; chapter_id: string }
  | { type: 'body_citation_verified'; chapter_id: string; reference_id: string; status: 'verified' | 'partial' | 'unsupported'; reason?: string }
  | { type: 'body_chapter_completed'; chapter_id: string; character_count?: number }
  | { type: 'body_completed' }
  | { type: 'body_error'; message: string };
