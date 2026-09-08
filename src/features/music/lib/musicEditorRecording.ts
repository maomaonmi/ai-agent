export interface AudioInputDeviceOption {
  deviceId: string;
  label: string;
}

/** Calculate the RMS level of a PCM buffer as a bounded dBFS value. */
export function calculateRmsDb(samples: ArrayLike<number>, floorDb = -60): number {
  if (samples.length === 0) return floorDb;
  let sumSquares = 0;
  for (let index = 0; index < samples.length; index += 1) {
    const sample = Number(samples[index]) || 0;
    sumSquares += sample * sample;
  }
  const rms = Math.sqrt(sumSquares / samples.length);
  if (!Number.isFinite(rms) || rms <= 0) return floorDb;
  return Math.max(floorDb, Math.min(0, 20 * Math.log10(rms)));
}

/** Convert dBFS to the 0-1 range used by the level meter. */
export function meterLevelFromDb(db: number, floorDb = -60): number {
  if (!Number.isFinite(db)) return 0;
  return Math.max(0, Math.min(1, (db - floorDb) / (0 - floorDb)));
}

/**
 * Map dBFS to a perceptual display level. Quiet microphone input has a very
 * small linear range, so a gentle gamma curve makes real changes visible
 * without changing the dB value reported to the user.
 */
export function visualMeterLevelFromDb(db: number, floorDb = -60): number {
  const linearLevel = meterLevelFromDb(db, floorDb);
  return Math.pow(linearLevel, 0.45);
}

/** Calculate the instantaneous peak sample as a bounded dBFS value. */
export function calculatePeakDb(samples: ArrayLike<number>, floorDb = -60): number {
  let peak = 0;
  for (let index = 0; index < samples.length; index += 1) {
    const sample = Math.abs(Number(samples[index]) || 0);
    if (sample > peak) peak = sample;
  }
  if (!Number.isFinite(peak) || peak <= 0) return floorDb;
  return Math.max(floorDb, Math.min(0, 20 * Math.log10(peak)));
}

/** Use explicit colors so the active fill remains visible in every theme build. */
export function meterColorFromDb(db: number): string {
  if (db > -6) return '#f43f5e';
  if (db > -18) return '#fbbf24';
  return '#10b981';
}

/** Keep the current level and peak hold on one visible edge. */
export function meterDisplayLevel(currentLevel: number, peakLevel: number): number {
  const current = Number.isFinite(currentLevel) ? currentLevel : 0;
  const peak = Number.isFinite(peakLevel) ? peakLevel : 0;
  return Math.max(0, Math.min(1, Math.max(current, peak)));
}

export function selectAudioInputDevices(
  devices: readonly { kind: string; deviceId: string; label: string }[],
): AudioInputDeviceOption[] {
  return devices
    .filter((device) => device.kind === 'audioinput')
    .map((device) => ({
      deviceId: device.deviceId,
      label: device.label.trim() || `麦克风 ${device.deviceId.slice(0, 6) || '默认'}`,
    }));
}

export function normalizeCountInBars(value: number): 0 | 1 | 2 {
  return value === 1 || value === 2 ? value : 0;
}
