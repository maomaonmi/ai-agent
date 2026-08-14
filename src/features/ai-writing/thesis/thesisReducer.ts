import { EMPTY_THESIS_OUTLINE, ThesisOutlineEvent, ThesisOutlineState } from './thesisTypes';

export function thesisOutlineReducer(state: ThesisOutlineState, event: ThesisOutlineEvent): ThesisOutlineState {
  switch (event.type) {
    case 'thesis_outline_started':
      return { ...EMPTY_THESIS_OUTLINE, targetWords: event.target_words ?? state.targetWords, status: 'generating' };
    case 'token':
      return { ...state, rawStream: state.rawStream + event.token };
    case 'title':
      return { ...state, title: event.title };
    case 'preface': {
      const preface = { id: event.id, title: event.title, writingBrief: event.writing_brief ?? '' };
      return { ...state, prefaces: state.prefaces.some((item) => item.id === event.id) ? state.prefaces.map((item) => item.id === event.id ? preface : item) : [...state.prefaces, preface] };
    }
    case 'chapter': {
      const chapter = {
        id: event.id, order: event.order, title: event.title, summary: event.summary ?? '',
        baseTargetWords: event.target_words ?? 0, targetWords: event.target_words ?? 0, length: 'medium' as const, sections: [], references: [],
        status: 'streaming' as const, searchStatus: 'idle' as const, searchError: '',
      };
      return { ...state, chapters: state.chapters.some((item) => item.id === event.id) ? state.chapters.map((item) => item.id === event.id ? { ...item, ...chapter, sections: item.sections, references: item.references } : item) : [...state.chapters, chapter].sort((a, b) => a.order - b.order) };
    }
    case 'section':
      return { ...state, chapters: state.chapters.map((chapter) => {
        if (chapter.id !== event.chapter_id) return chapter;
        const section = { id: event.id, chapterId: event.chapter_id, order: event.order, title: event.title, writingBrief: event.writing_brief ?? '', targetWords: event.target_words ?? 0 };
        const sections = chapter.sections.some((item) => item.id === event.id) ? chapter.sections.map((item) => item.id === event.id ? section : item) : [...chapter.sections, section].sort((a, b) => a.order - b.order);
        return { ...chapter, sections };
      }) };
    case 'chapter_length': {
      const multiplier = event.length === 'short' ? 0.7 : event.length === 'long' ? 1.4 : 1;
      return { ...state, chapters: state.chapters.map((chapter) => chapter.id === event.chapter_id ? { ...chapter, length: event.length, targetWords: Math.round((chapter.baseTargetWords || chapter.targetWords || 500) * multiplier) } : chapter) };
    }
    case 'chapter_deleted':
      return { ...state, chapters: state.chapters.filter((chapter) => chapter.id !== event.chapter_id).map((chapter, index) => ({ ...chapter, order: index + 1, title: chapter.title.replace(/^\d+\./, `${index + 1}.`) })) };
    case 'chapter_search_started':
      return { ...state, chapters: state.chapters.map((chapter) => chapter.id === event.chapter_id ? { ...chapter, references: [], searchStatus: 'searching', searchError: '' } : chapter) };
    case 'research_phase':
      return { ...state, researchPhase: event.phase };
    case 'reference_found':
      return { ...state, chapters: state.chapters.map((chapter) => {
        if (chapter.id !== event.chapter_id || chapter.references.some((item) => item.url === event.url)) return chapter;
        const id = chapter.references.some((item) => item.id === event.id)
          ? `${event.id}-${chapter.references.length + 1}`
          : event.id;
        return { ...chapter, references: [...chapter.references, { id, chapterId: event.chapter_id, title: event.title, url: event.url, domain: event.domain, snippet: event.snippet, status: event.status }] };
      }) };
    case 'reference_scraped':
      return { ...state, chapters: state.chapters.map((chapter) => chapter.id === event.chapter_id ? { ...chapter, references: chapter.references.map((reference) => reference.id === event.id ? { ...reference, snippet: event.evidence, status: event.status } : reference) } : chapter) };
    case 'chapter_search_completed':
      return { ...state, chapters: state.chapters.map((chapter) => chapter.id === event.chapter_id ? { ...chapter, searchStatus: 'complete' } : chapter) };
    case 'chapter_search_failed':
      return { ...state, chapters: state.chapters.map((chapter) => chapter.id === event.chapter_id ? { ...chapter, searchStatus: 'failed', searchError: event.message ?? 'Deep Research 资料检索失败' } : chapter) };
    case 'done':
      return { ...state, status: 'ready', chapters: state.chapters.map((chapter) => ({ ...chapter, status: 'complete' })) };
    case 'error':
      return { ...state, status: 'failed', error: event.message };
  }
}
