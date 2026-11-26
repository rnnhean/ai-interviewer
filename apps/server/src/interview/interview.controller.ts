import { randomUUID } from 'node:crypto';
import { BadRequestException, Body, Controller, Get, Inject, Param, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { pipeUIMessageStreamToResponse } from 'ai';
import type { CreateSessionInput, DurationMin, SessionSnapshot, Track } from '@ai-interviewer/shared';
import { InterviewService } from './session.store';
import { createOpeningStream, createTurnStream } from './turn.service';
import { LlmService } from '../llm/llm.service';
import { TtsService } from '../tts/tts.service';
import { ReportService } from '../report/report.service';

const TRACKS: Track[] = ['agent-engineer', 'frontend-to-agent', 'backend-ai'];
const ATMOSPHERES = ['gentle', 'standard', 'pressure'] as const;
const DURATIONS: DurationMin[] = [15, 25, 40];

const NUDGE: Record<string, string> = {
  gentle: '时间还够，慢慢说，先讲你最熟的那部分。',
  standard: '我们时间有限，先给结论，再补两点细节。',
  pressure: '时间不多了，用三十秒把结论说完。',
};

@Controller('api/interview')
export class InterviewController {
  constructor(
    @Inject(InterviewService) private readonly interviews: InterviewService,
    @Inject(LlmService) private readonly llm: LlmService,
    @Inject(TtsService) private readonly tts: TtsService,
    @Inject(ReportService) private readonly reports: ReportService,
  ) {}

  @Post()
  create(@Body() body: Partial<CreateSessionInput>): { id: string; snapshot: SessionSnapshot } {
    if (!body.track || !TRACKS.includes(body.track)) throw new BadRequestException('面试方向不合法');
    if (!body.atmosphere || !ATMOSPHERES.includes(body.atmosphere)) throw new BadRequestException('面试氛围不合法');
    if (!body.durationMin || !DURATIONS.includes(body.durationMin)) throw new BadRequestException('面试时长不合法');

    const id = randomUUID();
    this.interviews.create(
      {
        track: body.track,
        atmosphere: body.atmosphere,
        durationMin: body.durationMin,
        ...(body.resumeText ? { resumeText: body.resumeText } : {}),
      },
      id,
    );
    return { id, snapshot: this.interviews.snapshot(id) };
  }

  @Get(':id')
  get(@Param('id') id: string): SessionSnapshot {
    return this.interviews.snapshot(id);
  }

  /** 开场白：没有用户输入，直接开流 */
  @Post(':id/opening')
  opening(@Param('id') id: string, @Res() res: Response): void {
    this.interviews.markUsedQuestion(id, 'opening');
    pipeUIMessageStreamToResponse({
      response: res,
      stream: createOpeningStream(this.deps(), id),
    });
  }

  @Post(':id/turn')
  turn(@Param('id') id: string, @Body() body: { text?: string; source?: 'voice' | 'text' }, @Res() res: Response): void {
    const text = (body.text ?? '').trim();
    if (text === '') throw new BadRequestException('回答不能为空');

    pipeUIMessageStreamToResponse({
      response: res,
      stream: createTurnStream(this.deps(), { sessionId: id, text, source: body.source ?? 'text' }),
    });
  }

  @Post(':id/interrupt')
  interrupt(@Param('id') id: string): { interrupted: boolean } {
    return { interrupted: this.interviews.interrupt(id) };
  }

  /** 冷场提醒：只给一句台词，前端自己播 */
  @Post(':id/nudge')
  nudge(@Param('id') id: string): { text: string } {
    const s = this.interviews.require(id);
    return { text: NUDGE[s.atmosphere] ?? NUDGE.standard! };
  }

  @Post(':id/finish')
  async finish(@Param('id') id: string): Promise<{ snapshot: SessionSnapshot }> {
    const s = this.interviews.require(id);
    if (s.status === 'finished' && s.report) return { snapshot: this.interviews.snapshot(id) };

    this.interviews.markFinishing(id);
    this.tts.disposeSession(id);

    const report = await this.reports.generate(this.interviews.snapshot(id));
    this.interviews.markFinished(id, report);
    return { snapshot: this.interviews.snapshot(id) };
  }

  private deps() {
    return { model: this.llm.model, interviews: this.interviews, tts: this.tts };
  }
}