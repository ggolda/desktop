/// <reference types="vite/client" />
import type { RebornBridge } from '@/shared/preload-api';

declare global {
  interface Window {
    reborn: RebornBridge;
  }
}

export {};
