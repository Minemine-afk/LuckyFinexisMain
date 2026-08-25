/**
 * Inline icons. Kept as local components rather than an icon package so the
 * bundle carries only the dozen glyphs the portal actually draws.
 */
interface IconProps {
  size?: number;
  className?: string;
}

const base = (size: number) => ({
  width: size,
  height: size,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.7,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
});

export const BellIcon = ({ size = 20 }: IconProps) => (
  <svg {...base(size)}>
    <path d="M18 8a6 6 0 1 0-12 0c0 7-3 8-3 8h18s-3-1-3-8" />
    <path d="M13.7 21a2 2 0 0 1-3.4 0" />
  </svg>
);

export const GiftIcon = ({ size = 20 }: IconProps) => (
  <svg {...base(size)}>
    <rect x="3" y="9" width="18" height="12" rx="1.5" />
    <path d="M3 13h18M12 9v12" />
    <path d="M12 9S10.5 3 8 3a2.5 2.5 0 0 0 0 6M12 9s1.5-6 4-6a2.5 2.5 0 0 1 0 6" />
  </svg>
);

export const CalendarIcon = ({ size = 20 }: IconProps) => (
  <svg {...base(size)}>
    <rect x="3" y="5" width="18" height="16" rx="2" />
    <path d="M3 10h18M8 3v4M16 3v4" />
  </svg>
);

export const DollarIcon = ({ size = 20 }: IconProps) => (
  <svg {...base(size)}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v10M14.5 9.5c0-1-1.1-1.7-2.5-1.7s-2.5.7-2.5 1.8 1 1.5 2.5 1.9 2.6.8 2.6 1.9-1.1 1.8-2.6 1.8-2.5-.7-2.5-1.7" />
  </svg>
);

export const UserIcon = ({ size = 20 }: IconProps) => (
  <svg {...base(size)}>
    <circle cx="12" cy="8" r="3.6" />
    <path d="M4.5 20a7.5 7.5 0 0 1 15 0" />
  </svg>
);

export const NetworkIcon = ({ size = 20 }: IconProps) => (
  <svg {...base(size)}>
    <circle cx="6" cy="6" r="2.4" />
    <circle cx="18" cy="6" r="2.4" />
    <circle cx="12" cy="18" r="2.4" />
    <path d="M7.6 7.7 10.9 15.8M16.4 7.7 13.1 15.8M8.4 6h7.2" />
  </svg>
);

export const UploadIcon = ({ size = 20 }: IconProps) => (
  <svg {...base(size)}>
    <path d="M12 16V4M8 8l4-4 4 4" />
    <path d="M4 16v2.5A2.5 2.5 0 0 0 6.5 21h11a2.5 2.5 0 0 0 2.5-2.5V16" />
  </svg>
);

export const SearchIcon = ({ size = 18 }: IconProps) => (
  <svg {...base(size)}>
    <circle cx="10.5" cy="10.5" r="6" />
    <path d="M15 15l4.5 4.5" />
  </svg>
);

export const CloseIcon = ({ size = 18 }: IconProps) => (
  <svg {...base(size)}>
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
);

export const SignOutIcon = ({ size = 20 }: IconProps) => (
  <svg {...base(size)}>
    <path d="M14 20H6.5A2.5 2.5 0 0 1 4 17.5v-11A2.5 2.5 0 0 1 6.5 4H14" />
    <path d="M17 15l4-3-4-3M21 12H10" />
  </svg>
);

export const InfoIcon = ({ size = 16 }: IconProps) => (
  <svg {...base(size)}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v5M12 8v.5" />
  </svg>
);

export const PlaneIcon = ({ size = 20 }: IconProps) => (
  <svg {...base(size)}>
    <path d="M10.2 3.4a1.6 1.6 0 0 1 3.1 0L15 10l5.6 2.6a1.4 1.4 0 0 1-.6 2.7L13.8 14l-.5 4.3 2 1.7a1 1 0 0 1-.8 1.7l-2.5-.6-2.5.6a1 1 0 0 1-.8-1.7l2-1.7-.5-4.3-6.2 1.3a1.4 1.4 0 0 1-.6-2.7L9 10z" />
  </svg>
);
