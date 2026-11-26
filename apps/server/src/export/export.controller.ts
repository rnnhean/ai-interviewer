import { Controller, Get, Inject, Param, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { InterviewService } from '../interview/session.store';
import { exportFileName, toJson, toMarkdown } from './export.service';

@Controller('api/interview')
export class ExportController {
  constructor(@Inject(InterviewService) private readonly interviews: InterviewService) {}

  @Get(':id/export')
  export(
    @Param('id') id: string,
    @Query('format') format: string | undefined,
    @Res() res: Response,
  ): void {
    const snapshot = this.interviews.snapshot(id);

    // 报告还在生成：让前端提示「报告生成中」，不要给半个文件
    if (snapshot.status === 'finishing' || (snapshot.status === 'finished' && !snapshot.report)) {
      res.status(202).json({ pending: true });
      return;
    }

    const names = exportFileName(snapshot);
    const asJson = format === 'json';
    const body = asJson ? toJson(snapshot) : toMarkdown(snapshot);
    const filename = encodeURIComponent(asJson ? names.json : names.md);

    res.setHeader('Content-Type', asJson ? 'application/json; charset=utf-8' : 'text/markdown; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${filename}`);
    res.send(body);
  }
}