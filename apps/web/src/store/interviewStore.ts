import { create } from 'zustand';
import type { Atmosphere, DurationMin, InterviewPhase, SessionSnapshot, Track } from '@ai-interviewer/shared';

export interface SetupState {
  track: Track;
  atmosphere: Atmosphere;
  durationMin: DurationMin;
  resumeText: string;
}

interface InterviewStore extends SetupState {
  sessionId: string | null;
  snapshot: SessionSnapshot | null;
  phase: InterviewPhase;
  askedInPhase: number;
  /** 实时字幕：ASR 的 partial */
  caption: string;
  /** 已确认的整轮文本（尚未提交给模型） */
  draft: string;
  setSetup: (patch: Partial<SetupState>) => void;
  setSession: (id: string, snapshot: SessionSnapshot) => void;
  setSnapshot: (snapshot: SessionSnapshot) => void;
  setPhase: (phase: InterviewPhase, askedInPhase: number) => void;
  setCaption: (text: string) => void;
  setDraft: (text: string) => void;
  reset: () => void;
}

const DEFAULT_SETUP: SetupState = {
  track: 'frontend-to-agent',
  atmosphere: 'standard',
  durationMin: 25,
  resumeText: '',
};

export const useInterviewStore = create<InterviewStore>((set) => ({
  ...DEFAULT_SETUP,
  sessionId: null,
  snapshot: null,
  phase: 'intro',
  askedInPhase: 0,
  caption: '',
  draft: '',

  setSetup: (patch) => set(patch),
  setSession: (id, snapshot) => set({ sessionId: id, snapshot, phase: snapshot.phase, askedInPhase: snapshot.askedInPhase }),
  setSnapshot: (snapshot) => set({ snapshot, phase: snapshot.phase, askedInPhase: snapshot.askedInPhase }),
  setPhase: (phase, askedInPhase) => set({ phase, askedInPhase }),
  setCaption: (caption) => set({ caption }),
  setDraft: (draft) => set({ draft }),
  reset: () => set({ ...DEFAULT_SETUP, sessionId: null, snapshot: null, phase: 'intro', askedInPhase: 0, caption: '', draft: '' }),
}));
