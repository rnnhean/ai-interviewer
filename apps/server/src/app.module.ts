import { Module } from '@nestjs/common';
import { CorrectionService } from './asr/correction.service';
import { TermNormalizer } from './asr/normalizer.service';
import { LlmService } from './llm/llm.service';
import { InterviewController } from './interview/interview.controller';
import { InterviewService, SessionStore } from './interview/session.store';
import { ExportController } from './export/export.controller';
import { ReportService } from './report/report.service';
import { RealtimeServer } from './realtime/realtime.server';
import { TtsHub } from './tts/tts.hub';
import { TtsService } from './tts/tts.service';

@Module({
  controllers: [InterviewController, ExportController],
  providers: [
    LlmService,
    SessionStore,
    InterviewService,
    ReportService,
    CorrectionService,
    {
      provide: TermNormalizer,
      useFactory: (llm: LlmService) => TermNormalizer.fromLlm(llm),
      inject: [LlmService],
    },
    TtsHub,
    TtsService,
    RealtimeServer,
  ],
})
export class AppModule {}