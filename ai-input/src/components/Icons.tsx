import type { FC, SVGProps, ReactNode } from 'react';

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

const make = (path: ReactNode) => {
  const C: FC<IconProps> = ({ size = 16, strokeWidth = 1.8, ...rest }) => (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...rest}
    >
      {path}
    </svg>
  );
  return C;
};

export const PlusIcon = make(
  <>
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  </>
);

export const ChatIcon = make(
  <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
);

export const PPTIcon = make(
  <>
    <rect x="2" y="4" width="20" height="13" rx="2" />
    <line x1="8" y1="21" x2="16" y2="21" />
    <line x1="12" y1="17" x2="12" y2="21" />
    <path d="M9 8h4a1.5 1.5 0 0 1 0 3H9V8z" fill="currentColor" stroke="none" />
  </>
);

export const MusicIcon = make(
  <>
    <path d="M9 18V5l12-2v13" />
    <circle cx="6" cy="18" r="3" />
    <circle cx="18" cy="16" r="3" />
  </>
);

export const PenIcon = make(
  <>
    <path d="M12 19l7-7 3 3-7 7-3-3z" />
    <path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z" />
    <line x1="2" y1="2" x2="9.586" y2="9.586" />
  </>
);

export const ImageIcon = make(
  <>
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <circle cx="8.5" cy="8.5" r="1.5" />
    <polyline points="21 15 16 10 5 21" />
  </>
);

export const VideoIcon = make(
  <>
    <rect x="2" y="6" width="14" height="12" rx="2" />
    <path d="M22 8l-6 4 6 4V8z" />
  </>
);

export const ResearchIcon = make(
  <>
    <path d="M10 2v6L4.6 17.3a2 2 0 0 0 1.7 3h11.4a2 2 0 0 0 1.7-3L14 8V2" />
    <line x1="9" y1="2" x2="15" y2="2" />
    <line x1="7" y1="14" x2="17" y2="14" />
  </>
);

export const MoreIcon = make(
  <>
    <rect x="3" y="3" width="7" height="7" rx="1" />
    <rect x="14" y="3" width="7" height="7" rx="1" />
    <rect x="14" y="14" width="7" height="7" rx="1" />
    <rect x="3" y="14" width="7" height="7" rx="1" />
  </>
);

export const ChevronRightIcon = make(<polyline points="9 6 15 12 9 18" />);
export const ChevronDownIcon = make(<polyline points="6 9 12 15 18 9" />);
export const ChevronUpIcon = make(<polyline points="18 15 12 9 6 15" />);

export const CloseIcon = make(
  <>
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </>
);

export const MicIcon = make(
  <>
    <rect x="9" y="2" width="6" height="12" rx="3" />
    <path d="M5 11a7 7 0 0 0 14 0" />
    <line x1="12" y1="18" x2="12" y2="22" />
  </>
);

export const SendIcon = make(
  <>
    <line x1="12" y1="19" x2="12" y2="5" />
    <polyline points="5 12 12 5 19 12" />
  </>
);

export const SparkleIcon = make(
  <>
    <path d="M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6L12 3z" fill="currentColor" stroke="none" />
    <path d="M19 14l.7 2.3L22 17l-2.3.7L19 20l-.7-2.3L16 17l2.3-.7L19 14z" fill="currentColor" stroke="none" />
  </>
);

export const UploadIcon = make(
  <>
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="17 8 12 3 7 8" />
    <line x1="12" y1="3" x2="12" y2="15" />
  </>
);

export const WaveIcon = make(
  <>
    <line x1="6" y1="9" x2="6" y2="15" />
    <line x1="10" y1="6" x2="10" y2="18" />
    <line x1="14" y1="6" x2="14" y2="18" />
    <line x1="18" y1="9" x2="18" y2="15" />
  </>
);

export const FilmIcon = make(
  <>
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <path d="M7 3v18M17 3v18M3 7h4M3 12h4M3 17h4M17 7h4M17 12h4M17 17h4" />
  </>
);

export const PaintIcon = make(
  <>
    <circle cx="13" cy="6" r="1.5" fill="currentColor" stroke="none" />
    <path d="M12 22a7 7 0 0 1-7-7c0-3 2-5 4-7l1-1a3 3 0 0 1 4 0l1 1c2 2 4 4 4 7a7 7 0 0 1-7 7z" />
    <path d="M9 12h6" />
  </>
);

export const ExploreIcon = make(
  <>
    <path d="M5 19l4-1 9-9-3-3-9 9-1 4z" />
    <line x1="14" y1="6" x2="18" y2="10" />
  </>
);
