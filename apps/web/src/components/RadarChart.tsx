import { useEffect, useRef } from 'react';
import * as echarts from 'echarts';
import type { DimensionScore } from '@ai-interviewer/shared';
import { DIMENSION_LABEL } from '@ai-interviewer/shared';

/** 五维雷达图。用 echarts 原生 API，不额外引 React 封装 */
export function RadarChart({ dimensions }: { dimensions: DimensionScore[] }): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    // 用 SVG 渲染器：不需要 canvas，测试环境（jsdom）也能跑
    const chart = echarts.init(ref.current, undefined, { renderer: 'svg' });
    chartRef.current = chart;

    const onResize = (): void => chart.resize();
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      chart.dispose();
      chartRef.current = null;
    };
  }, []);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    chart.setOption({
      radar: {
        indicator: dimensions.map((d) => ({ name: DIMENSION_LABEL[d.key], max: 10 })),
        radius: '62%',
        splitNumber: 5,
        axisName: { color: '#495057', fontSize: 12 },
      },
      series: [
        {
          type: 'radar',
          data: [{ value: dimensions.map((d) => d.score), name: '得分' }],
          areaStyle: { opacity: 0.25 },
          lineStyle: { color: '#4c6ef5' },
          itemStyle: { color: '#4c6ef5' },
        },
      ],
    });
  }, [dimensions]);

  return <div className="radar-box" ref={ref} data-testid="radar" />;
}
