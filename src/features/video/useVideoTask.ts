'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { getVideoTaskStatus, openVideoTaskStream, type VideoTask } from '../../lib/api';

export type VideoConnectionState = 'connecting' | 'connected' | 'polling' | 'disconnected';

function shouldAccept(current: VideoTask | null, next: VideoTask) {
  if (!current) return true;
  if (current.status === 'SUCCEEDED' || current.status === 'FAILED' || current.status === 'CANCELLED') return false;
  return next.updated_at >= current.updated_at;
}

export function useVideoTask(taskId: string | null, initialTask: VideoTask | null = null) {
  const [task, setTask] = useState<VideoTask | null>(initialTask);
  const [connectionState, setConnectionState] = useState<VideoConnectionState>('polling');
  const [error, setError] = useState('');
  const lastUpdatedRef = useRef(initialTask?.updated_at ?? 0);
  const taskRef = useRef<VideoTask | null>(initialTask);

  const applyTask = useCallback((next: VideoTask) => {
    if (next.updated_at < lastUpdatedRef.current) return;
    lastUpdatedRef.current = next.updated_at;
    setTask((current) => {
      const accepted = shouldAccept(current, next) ? next : current;
      taskRef.current = accepted;
      return accepted;
    });
  }, []);

  useEffect(() => {
    // A history click can change taskId while the previous task is terminal.
    // Reset the hook's snapshot first so `task ?? initialTask` cannot render
    // the previous generation during the new task's first request.
    setTask(initialTask);
    taskRef.current = initialTask;
    lastUpdatedRef.current = initialTask?.updated_at ?? 0;
    if (!taskId) {
      setTask(null);
      setConnectionState('polling');
      setError('');
      lastUpdatedRef.current = 0;
      return undefined;
    }
    let disposed = false;
    const timer = window.setInterval(() => {
      if (taskRef.current?.status !== 'SUCCEEDED' && taskRef.current?.status !== 'FAILED' && taskRef.current?.status !== 'CANCELLED') void refresh();
    }, 3000);
    setConnectionState('connecting');
    setError('');
    const refresh = async () => {
      try {
        const next = await getVideoTaskStatus(taskId);
        if (!disposed) {
          applyTask(next);
          // A successful short poll is authoritative even if EventSource is
          // still reconnecting. Do not keep rendering a stale "disconnected"
          // state after the task has already reached a newer snapshot.
          setConnectionState('polling');
        }
      } catch (cause) {
        if (!disposed) setError(cause instanceof Error ? cause.message : '读取视频任务失败');
      }
    };
    void refresh();
    const source = openVideoTaskStream(taskId, (eventName, payload) => {
      if (disposed) return;
      setConnectionState('connected');
      if (eventName === 'snapshot' && payload.id) applyTask(payload as unknown as VideoTask);
      else if (eventName === 'result' || eventName === 'error' || eventName === 'status' || eventName === 'progress') void refresh();
    }, () => {
      if (!disposed) {
        setConnectionState('disconnected');
        // EventSource retries are browser-managed and can be suspended by
        // laptop sleep/network changes. Force an immediate status read so a
        // completed provider task is not hidden behind a stale 90% snapshot.
        void refresh();
      }
    });
    return () => {
      disposed = true;
      source.close();
      window.clearInterval(timer);
    };
  }, [applyTask, initialTask, taskId]);

  return { task, connectionState, error, refresh: async () => { if (taskId) applyTask(await getVideoTaskStatus(taskId)); } };
}
