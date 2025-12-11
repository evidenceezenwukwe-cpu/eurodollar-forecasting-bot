import { memo, useMemo } from 'react';
import {
  ResponsiveContainer,
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ReferenceLine,
} from 'recharts';
import { Candle, TechnicalIndicators } from '@/types/trading';
import { format } from 'date-fns';

interface CandlestickChartProps {
  candles: Candle[];
  indicators?: TechnicalIndicators | null;
  currentPrice?: number;
  entryPrice?: number;
  stopLoss?: number;
  takeProfit1?: number;
  takeProfit2?: number;
  height?: number;
}

export const CandlestickChart = memo(function CandlestickChart({
  candles,
  indicators,
  currentPrice,
  entryPrice,
  stopLoss,
  takeProfit1,
  takeProfit2,
  height = 400,
}: CandlestickChartProps) {
  // Transform candles for display
  const chartData = useMemo(() => {
    return candles.slice(-50).map((candle, index) => {
      const isGreen = candle.close >= candle.open;
      return {
        time: candle.timestamp,
        displayTime: format(new Date(candle.timestamp), 'HH:mm'),
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
        // For bar chart representation
        body: Math.abs(candle.close - candle.open),
        base: Math.min(candle.open, candle.close),
        isGreen,
        // Wick data
        upperWick: candle.high - Math.max(candle.open, candle.close),
        lowerWick: Math.min(candle.open, candle.close) - candle.low,
      };
    });
  }, [candles]);

  // Calculate price range for Y axis
  const priceRange = useMemo(() => {
    if (chartData.length === 0) return { min: 0, max: 1 };
    
    let min = Math.min(...chartData.map((d) => d.low));
    let max = Math.max(...chartData.map((d) => d.high));
    
    // Include signal levels in range
    if (stopLoss) min = Math.min(min, stopLoss);
    if (takeProfit1) max = Math.max(max, takeProfit1);
    if (takeProfit2) max = Math.max(max, takeProfit2);
    
    const padding = (max - min) * 0.05;
    return { min: min - padding, max: max + padding };
  }, [chartData, stopLoss, takeProfit1, takeProfit2]);

  if (candles.length === 0) {
    return (
      <div className="trading-card p-4 flex items-center justify-center" style={{ height }}>
        <p className="text-muted-foreground">No chart data available</p>
      </div>
    );
  }

  // Custom candlestick shape
  const CandleShape = (props: any) => {
    const { x, y, width, height, payload } = props;
    const candleWidth = Math.max(width * 0.6, 3);
    const wickWidth = 1;
    const centerX = x + width / 2;
    
    const fill = payload.isGreen ? 'hsl(var(--chart-bullish))' : 'hsl(var(--chart-bearish))';
    const stroke = fill;

    // Calculate wick positions
    const bodyTop = y;
    const bodyBottom = y + height;
    const wickTop = bodyTop - (payload.upperWick / (priceRange.max - priceRange.min)) * 400;
    const wickBottom = bodyBottom + (payload.lowerWick / (priceRange.max - priceRange.min)) * 400;

    return (
      <g>
        {/* Upper wick */}
        <line
          x1={centerX}
          y1={bodyTop}
          x2={centerX}
          y2={Math.max(wickTop, 0)}
          stroke={stroke}
          strokeWidth={wickWidth}
        />
        {/* Lower wick */}
        <line
          x1={centerX}
          y1={bodyBottom}
          x2={centerX}
          y2={wickBottom}
          stroke={stroke}
          strokeWidth={wickWidth}
        />
        {/* Body */}
        <rect
          x={centerX - candleWidth / 2}
          y={bodyTop}
          width={candleWidth}
          height={Math.max(height, 1)}
          fill={fill}
          stroke={stroke}
          strokeWidth={0.5}
        />
      </g>
    );
  };

  return (
    <div className="trading-card p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold">EUR/USD Price Chart</h3>
        {currentPrice && (
          <span className="font-mono text-lg font-bold">{currentPrice.toFixed(5)}</span>
        )}
      </div>

      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart data={chartData} margin={{ top: 10, right: 10, bottom: 20, left: 10 }}>
          <CartesianGrid
            strokeDasharray="3 3"
            stroke="hsl(var(--chart-grid))"
            vertical={false}
          />
          
          <XAxis
            dataKey="displayTime"
            tick={{ fontSize: 10, fill: 'hsl(var(--chart-text))' }}
            tickLine={{ stroke: 'hsl(var(--chart-grid))' }}
            axisLine={{ stroke: 'hsl(var(--chart-grid))' }}
            interval="preserveStartEnd"
          />
          
          <YAxis
            domain={[priceRange.min, priceRange.max]}
            tick={{ fontSize: 10, fill: 'hsl(var(--chart-text))' }}
            tickLine={{ stroke: 'hsl(var(--chart-grid))' }}
            axisLine={{ stroke: 'hsl(var(--chart-grid))' }}
            tickFormatter={(value) => value.toFixed(4)}
            orientation="right"
            width={60}
          />

          <Tooltip
            content={({ active, payload }) => {
              if (active && payload && payload.length) {
                const data = payload[0].payload;
                return (
                  <div className="bg-popover border border-border rounded-lg p-2 shadow-lg text-sm">
                    <p className="text-muted-foreground text-xs mb-1">{data.time}</p>
                    <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 font-mono text-xs">
                      <span className="text-muted-foreground">Open:</span>
                      <span>{data.open.toFixed(5)}</span>
                      <span className="text-muted-foreground">High:</span>
                      <span>{data.high.toFixed(5)}</span>
                      <span className="text-muted-foreground">Low:</span>
                      <span>{data.low.toFixed(5)}</span>
                      <span className="text-muted-foreground">Close:</span>
                      <span className={data.isGreen ? 'text-bullish' : 'text-bearish'}>
                        {data.close.toFixed(5)}
                      </span>
                    </div>
                  </div>
                );
              }
              return null;
            }}
          />

          {/* Signal levels */}
          {entryPrice && (
            <ReferenceLine
              y={entryPrice}
              stroke="hsl(var(--primary))"
              strokeDasharray="5 5"
              strokeWidth={1.5}
              label={{ value: 'Entry', fill: 'hsl(var(--primary))', fontSize: 10 }}
            />
          )}
          {stopLoss && (
            <ReferenceLine
              y={stopLoss}
              stroke="hsl(var(--chart-bearish))"
              strokeDasharray="5 5"
              strokeWidth={1.5}
              label={{ value: 'SL', fill: 'hsl(var(--chart-bearish))', fontSize: 10 }}
            />
          )}
          {takeProfit1 && (
            <ReferenceLine
              y={takeProfit1}
              stroke="hsl(var(--chart-bullish))"
              strokeDasharray="5 5"
              strokeWidth={1.5}
              label={{ value: 'TP1', fill: 'hsl(var(--chart-bullish))', fontSize: 10 }}
            />
          )}
          {takeProfit2 && (
            <ReferenceLine
              y={takeProfit2}
              stroke="hsl(var(--chart-bullish))"
              strokeDasharray="5 5"
              strokeWidth={1.5}
              label={{ value: 'TP2', fill: 'hsl(var(--chart-bullish))', fontSize: 10 }}
            />
          )}

          {/* Bollinger Bands */}
          {indicators && (
            <>
              <Line
                type="monotone"
                dataKey={() => indicators.bollingerBands.upper}
                stroke="hsl(var(--primary))"
                strokeWidth={1}
                strokeDasharray="3 3"
                dot={false}
                opacity={0.5}
              />
              <Line
                type="monotone"
                dataKey={() => indicators.bollingerBands.middle}
                stroke="hsl(var(--primary))"
                strokeWidth={1}
                dot={false}
                opacity={0.5}
              />
              <Line
                type="monotone"
                dataKey={() => indicators.bollingerBands.lower}
                stroke="hsl(var(--primary))"
                strokeWidth={1}
                strokeDasharray="3 3"
                dot={false}
                opacity={0.5}
              />
            </>
          )}

          {/* Candlestick bars */}
          <Bar
            dataKey="body"
            shape={<CandleShape />}
            isAnimationActive={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
});
