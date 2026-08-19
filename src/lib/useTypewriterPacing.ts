'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * 匀速打字机 pacing 层：把后端 burst 输出与上屏节奏解耦。
 *
 * 设计（计数型）：全文始终由调用方持有（state/ref），本 hook 只维护
 * "已上屏字符数" displayedLength，调用方用 content.slice(0, displayedLength)
 * 渲染。因此会话持久化快照不受 pacing 影响（快照写全文）。
 *
 * - push：流式源，token 到达即累计总量，定时器匀速消费；
 * - commit：整块源（done/报告），一次性登记全文并匀速展开；
 * - flush：立即全量上屏（点击跳过 / 新一轮发送前兜底）；
 * - reset：清零（一般无需调用，commit 会覆盖总量）。
 *
 * 自适应步长：积压越多单 tick 出字越多，防尾部延迟；下限 2 字/tick 保匀速观感。
 */

const TICK_MS = 32;

export interface TypewriterPacing {
  push: (text: string) => void;
  commit: (fullText: string) => void;
  flush: () => void;
  reset: () => void;
}

export function useTypewriterPacing(): { displayedLength: number; active: boolean; pacing: TypewriterPacing } {
  const [displayedLength, setDisplayedLength] = useState(0);
  const [active, setActive] = useState(false);
  const totalRef = useRef(0);
  const displayedRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stop = useCallback(() => {
    if (timerRef.current !== null) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setActive(false);
  }, []);

  const ensureTimer = useCallback(() => {
    if (timerRef.current !== null) return;
    setActive(true);
    timerRef.current = setInterval(() => {
      const pending = totalRef.current - displayedRef.current;
      if (pending <= 0) {
        stop();
        return;
      }
      const step = pending > 1200 ? 24 : pending > 400 ? 12 : pending > 120 ? 6 : 2;
      displayedRef.current = Math.min(totalRef.current, displayedRef.current + step);
      setDisplayedLength(displayedRef.current);
    }, TICK_MS);
  }, [stop]);

  const push = useCallback((text: string) => {
    if (!text) return;
    totalRef.current += text.length;
    ensureTimer();
  }, [ensureTimer]);

  const commit = useCallback((fullText: string) => {
    totalRef.current = fullText.length;
    if (displayedRef.current > totalRef.current) {
      displayedRef.current = totalRef.current;
      setDisplayedLength(displayedRef.current);
    }
    if (totalRef.current > displayedRef.current) ensureTimer();
    else stop();
  }, [ensureTimer, stop]);

  const flush = useCallback(() => {
    displayedRef.current = totalRef.current;
    setDisplayedLength(displayedRef.current);
    stop();
  }, [stop]);

  const reset = useCallback(() => {
    totalRef.current = 0;
    displayedRef.current = 0;
    setDisplayedLength(0);
    stop();
  }, [stop]);

  useEffect(() => stop, [stop]);

  return { displayedLength, active, pacing: { push, commit, flush, reset } };
}
