import 'react';

declare module 'react' {
  interface SelectHTMLAttributes<T> {
    /** Internal constraint used by dynamic image generation controls. */
    max?: number | string;
  }
}
