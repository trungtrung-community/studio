'use client';

/**
 * @fileoverview Choosing which microphone is recorded, and seeing which one is.
 *
 * Getting this wrong is expensive in a way almost nothing else here is. It is
 * not audible until playback, and a sitting's worth of takes on the laptop's
 * built-in microphone has to be recorded again from the beginning.
 *
 * The line under the control reports the device **actually** in use, read back
 * from the live audio track rather than remembered from what was requested.
 * Those two are only ever different when it matters.
 */

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type {MicrophoneOption} from '@/hooks/use-recorder';

interface MicrophonePickerProps {
  microphones: MicrophoneOption[];
  selectedDeviceId: string | undefined;
  onSelect: (deviceId: string) => void;
  /** The device the live track reports. Null before the microphone opens. */
  activeLabel: string | null;
}

export function MicrophonePicker({
  microphones,
  selectedDeviceId,
  onSelect,
  activeLabel,
}: MicrophonePickerProps) {
  if (microphones.length === 0) {
    return null;
  }

  // What the browser reports as chosen, which is the default input until one is
  // picked. Matching on the active device rather than the stored id means the
  // control shows the truth on a first visit too.
  const shownValue =
    selectedDeviceId ??
    microphones.find((microphone) => microphone.label === activeLabel)?.deviceId;

  // Base UI resolves the trigger's text through this map, and shows the raw
  // value without it. A device id is sixty-four characters of hex, so the
  // control read as a fault rather than as a choice.
  const labelsByDeviceId = Object.fromEntries(
    microphones.map((microphone) => [microphone.deviceId, microphone.label]),
  );

  return (
    <div className="space-y-1.5">
      <Select
        items={labelsByDeviceId}
        value={shownValue}
        // The component allows clearing to null; a microphone cannot be cleared,
        // so an empty selection is simply ignored.
        onValueChange={(value) => value && onSelect(value)}
      >
        <SelectTrigger className="w-full" aria-label="Microphone">
          <SelectValue placeholder="Choose a microphone" />
        </SelectTrigger>
        <SelectContent>
          {microphones.map((microphone) => (
            <SelectItem key={microphone.deviceId} value={microphone.deviceId}>
              {microphone.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {activeLabel ? (
        <p className="text-muted-foreground text-xs">
          Recording from <span className="text-fg-accent">{activeLabel}</span>
        </p>
      ) : null}
    </div>
  );
}
