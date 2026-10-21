import { useId, type CSSProperties } from 'react';
import { cn } from '@/lib/cn';

/**
 * What Flurry is showing. Most are moments (a reaction that plays and returns to idle); `dragged`,
 * `point`, `thinking`, `sleep` and `settled` last as long as the state they show.
 */
export type FlurryMood =
  | 'idle'
  | 'curious'
  | 'thinking'
  | 'success'
  | 'error'
  | 'settled'
  | 'listening'
  | 'sleep'
  | 'wave'
  | 'dragged'
  | 'attention'
  | 'point';

/** The body's outline (a round snow creature with a three-flame tuft and a tail), in a 120 × 120 box. */
export const FLURRY_BODY =
  'M88 112C80 115 68 112 58 107 44 102 31 94 27 81 24 73 23 64 24 56 25 43 31 34 39 29 36 25 33 20 34 15 35 12 38 11 40 13 45 17 48 21 51 25 50 15 56 6 66 2 70 0 76 1 76 4 71 8 71 15 74 22 78 18 83 15 88 14 91 14 92 17 90 19 88 22 87 26 87 30 91 36 93 45 92 54 91 66 88 75 86 83 84 92 84 99 88 104 91 108 93 111 88 112Z';
const ARM_LEFT = 'M29 72C22 71 15 75 12 81 10 86 14 90 19 88 24 86 28 82 31 79Z';
const ARM_RIGHT = 'M88 62C93 57 97 51 101 47 104 44 109 45 109 49 110 54 104 61 96 69Z';

/**
 * Flurry, as drawn in the app: a small floating snow creature with a rounded body, a three-flame
 * tuft, two expressive eyes, tiny arms and a soft icy-blue glow (after the supplied artwork), with a
 * soft outline so its silhouette reads at any size (`mini` simplifies it for 16–32 px: no shading,
 * a heavier outline).
 *
 * Poses and expressions are CSS (index.css, `.flurry--*`): it floats, blinks and looks around when
 * idle; turns towards you (curious); stretches with its arms up while carried (dragged) and squashes
 * a little when put down (`landed`); thinks with two flakes circling slowly; closes its eyes in a
 * smile when something worked; raises its brows when something needs you (attention); points with
 * its right arm (the aim comes from --flurry-aim on an ancestor); naps; and settles while you type.
 * The eyes follow --gx/--gy, set by whatever moves it.
 *
 * Decorative: it's always aria-hidden, and whatever it expresses is also said in words nearby.
 * `still` turns every animation off (reduced motion, or the person's own choice).
 */
export function FlurryFigure({
  mood = 'idle',
  still = false,
  glow = true,
  mini = false,
  landed = false,
  className,
  style,
}: {
  mood?: FlurryMood;
  still?: boolean;
  glow?: boolean;
  /** Drawn at 32 px or less: simpler, with a heavier outline. */
  mini?: boolean;
  /** Just put down: a small squash, once. */
  landed?: boolean;
  className?: string;
  style?: CSSProperties;
}) {
  const id = useId().replace(/:/g, '');
  const u = (name: string) => `url(#${id}-${name})`;
  const eye = (x: number, y: number, side: 'left' | 'right') => (
    <g className={`flurry__eye flurry__eye--${side}`}>
      <ellipse cx={x} cy={y} rx="8.4" ry="10" fill={u('eye')} />
      <ellipse className="flurry__detail" cx={x} cy={y + 2.5} rx="7.4" ry="8" fill={u('iris')} />
      <circle cx={x + 3.2} cy={y - 4.8} r="3.1" fill="#fff" />
      <circle className="flurry__detail" cx={x - 2.8} cy={y + 4.8} r="1.25" fill="#fff" opacity=".75" />
    </g>
  );
  return (
    <svg
      viewBox="0 0 120 120"
      className={cn('flurry', `flurry--${mood}`, still && 'flurry--still', mini && 'flurry--mini', landed && 'flurry--landed', className)}
      style={style}
      aria-hidden="true"
      focusable="false"
      data-flurry-mood={mood}
    >
      <defs>
        <radialGradient id={`${id}-glow`} cx="50%" cy="56%" r="50%">
          <stop offset="0" stopColor="#a9d6ee" stopOpacity=".55" />
          <stop offset=".65" stopColor="#a9d6ee" stopOpacity=".16" />
          <stop offset="1" stopColor="#a9d6ee" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={`${id}-body`} cx="46%" cy="46%" r="60%">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset=".55" stopColor="#f7fbfe" />
          <stop offset=".82" stopColor="#e0eef9" />
          <stop offset="1" stopColor="#b3d7f1" />
        </radialGradient>
        <linearGradient id={`${id}-tips`} x1="0" y1="1" x2=".1" y2="0">
          <stop offset=".4" stopColor="#ffffff" stopOpacity="0" />
          <stop offset=".75" stopColor="#c6e2f5" stopOpacity=".85" />
          <stop offset="1" stopColor="#83bfea" />
        </linearGradient>
        <linearGradient id={`${id}-under`} x1=".3" y1=".25" x2=".75" y2="1">
          <stop offset=".55" stopColor="#9ccbea" stopOpacity="0" />
          <stop offset="1" stopColor="#74b0de" stopOpacity=".75" />
        </linearGradient>
        <linearGradient id={`${id}-light`} x1=".1" y1=".05" x2=".85" y2=".95">
          <stop offset="0" stopColor="#ffffff" stopOpacity=".9" />
          <stop offset=".45" stopColor="#ffffff" stopOpacity="0" />
          <stop offset="1" stopColor="#7db8e2" stopOpacity=".35" />
        </linearGradient>
        <radialGradient id={`${id}-eye`} cx="40%" cy="30%" r="78%">
          <stop offset="0" stopColor="#4f6f8d" />
          <stop offset=".42" stopColor="#21364a" />
          <stop offset="1" stopColor="#0d1822" />
        </radialGradient>
        <radialGradient id={`${id}-iris`} cx="50%" cy="88%" r="58%">
          <stop offset="0" stopColor="#9dc0de" stopOpacity=".8" />
          <stop offset="1" stopColor="#9dc0de" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={`${id}-arm`} cx="30%" cy="35%" r="80%">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset=".5" stopColor="#e6f2fb" />
          <stop offset="1" stopColor="#86c0eb" />
        </radialGradient>
        {/* Snow: a scatter of tiny sparkles, white and ice blue. */}
        <pattern id={`${id}-grain`} width="13" height="11" patternUnits="userSpaceOnUse">
          <circle cx="1.6" cy="2.2" r=".55" fill="#ffffff" />
          <circle cx="7.3" cy="4.1" r=".38" fill="#b9dbf3" />
          <circle cx="11.2" cy="1.4" r=".3" fill="#ffffff" />
          <circle cx="4.4" cy="8.6" r=".45" fill="#a7d0ef" />
          <circle cx="10.1" cy="9.3" r=".6" fill="#ffffff" />
          <circle cx="2.2" cy="5.8" r=".25" fill="#c9e3f6" />
          <circle cx="8.6" cy="7" r=".22" fill="#ffffff" />
        </pattern>
        <clipPath id={`${id}-clip`}>
          <path d={FLURRY_BODY} />
        </clipPath>
      </defs>

      {glow && <ellipse className="flurry__glow" cx="60" cy="62" rx="57" ry="56" fill={u('glow')} />}

      <g className="flurry__float">
        <g className="flurry__body">
          <path className="flurry__arm-left" d={ARM_LEFT} fill={u('arm')} stroke="#a7d0ec" strokeWidth="1" />
          <path d={FLURRY_BODY} fill={u('body')} />
          <g className="flurry__detail" clipPath={u('clip')}>
            <rect width="120" height="120" fill={u('under')} />
            <rect width="120" height="34" fill={u('tips')} />
            <rect width="120" height="120" fill={u('light')} />
            <rect width="120" height="120" fill={u('grain')} opacity=".7" />
          </g>
          <path className="flurry__outline" d={FLURRY_BODY} fill="none" stroke="#a9d1ee" strokeWidth="1.1" strokeLinejoin="round" />
          <path className="flurry__arm-right" d={ARM_RIGHT} fill={u('arm')} stroke="#a7d0ec" strokeWidth="1" />

          <g className="flurry__cheeks flurry__detail" fill="#a8d3ee" opacity=".55">
            <ellipse cx="36" cy="69" rx="4.4" ry="2.4" />
            <ellipse cx="79" cy="68" rx="4.4" ry="2.4" />
          </g>
          <g className="flurry__brows" fill="none" stroke="#2a3a48" strokeWidth="1.8" strokeLinecap="round">
            <path className="flurry__brow-left" d="M39.5 42.8q5-3 10-.6" />
            <path className="flurry__brow-right" d="M64.5 41.8q5-2.6 10 .4" />
          </g>

          <g className="flurry__eyes">
            <g className="flurry__gaze">
              {eye(45, 57, 'left')}
              {eye(70, 56, 'right')}
            </g>
          </g>
          {/* Eyes closed in a smile (something worked). */}
          <g className="flurry__happy" fill="none" stroke="#1d2a36" strokeWidth="2.8" strokeLinecap="round">
            <path d="M38.5 59q6.5-6.8 13 0" />
            <path d="M63.5 58q6.5-6.8 13 0" />
          </g>

          <path className="flurry__mouth flurry__mouth--smile" d="M53.9 69.4q3.6 3.6 7.2 0" fill="none" stroke="#1d2a36" strokeWidth="1.9" strokeLinecap="round" />
          <path className="flurry__mouth flurry__mouth--open" d="M52.9 68.6q4.7 6.4 9.4 0z" fill="#1d2a36" stroke="#1d2a36" strokeWidth="1.4" strokeLinejoin="round" />
          <ellipse className="flurry__mouth flurry__mouth--o" cx="57.6" cy="70.6" rx="2.6" ry="3.1" fill="#1d2a36" />
          <path className="flurry__mouth flurry__mouth--flat" d="M54.3 70.4h6.6" fill="none" stroke="#1d2a36" strokeWidth="1.9" strokeLinecap="round" />
        </g>
      </g>

      {/* Thinking: two flakes circle the head, slowly. */}
      <g className="flurry__flakes" fill="#7fb8de">
        <path d="M60 3l1.8 3.1-1.8 3.1-1.8-3.1z" />
        <path d="M60 3l1.8 3.1-1.8 3.1-1.8-3.1z" />
      </g>
      {/* Napping: a couple of small z's drift up. */}
      <g className="flurry__zzz" fill="none" stroke="#7fb8de" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M94 30h7l-7 8h7" />
        <path d="M106 16h5l-5 6h5" />
      </g>
      {/* Something worked: a few sparkles, once. */}
      <g className="flurry__sparkles" fill="#f1c27b">
        <path d="M106 30l1.8 4.2 4.2 1.8-4.2 1.8-1.8 4.2-1.8-4.2-4.2-1.8 4.2-1.8z" />
        <path d="M10 44l1.3 3 3 1.3-3 1.3-1.3 3-1.3-3-3-1.3 3-1.3z" />
        <path d="M102 94l1.1 2.5 2.5 1.1-2.5 1.1-1.1 2.5-1.1-2.5-2.5-1.1 2.5-1.1z" />
      </g>
    </svg>
  );
}

/** The detailed artwork (marketing version), with the right size for where it's shown. */
export function FlurryPortrait({ className, size = 480, alt = 'Flurry, Niveloft’s AI assistant: a small, friendly snow creature with a swept snow tuft, waving.', priority = false }: { className?: string; size?: 240 | 480 | 960; alt?: string; priority?: boolean }) {
  const srcSet = size === 240 ? '/flurry/flurry-240.webp 1x, /flurry/flurry-480.webp 2x' : size === 480 ? '/flurry/flurry-480.webp 1x, /flurry/flurry-960.webp 2x' : '/flurry/flurry-960.webp';
  return (
    <img
      src={`/flurry/flurry-${size}.webp`}
      srcSet={srcSet}
      width={size}
      height={size}
      alt={alt}
      loading={priority ? 'eager' : 'lazy'}
      decoding="async"
      className={cn('select-none', className)}
      draggable={false}
    />
  );
}
