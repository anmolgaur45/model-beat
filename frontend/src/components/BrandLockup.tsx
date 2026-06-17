// Model Beat brand lockup: the equalizer mark + "ModelBeat" wordmark.
// Pure/presentational (no hooks) so it drops into both server and client
// components. Header use passes `sm` (smaller, tagline auto-hidden); the hero
// and footer use the full size with `tag`. Styles live in globals.css (.lb*).

interface Props {
  sm?: boolean // header size
  mono?: boolean // collapse accent to ink (one-color)
  tag?: boolean // show the "Covering the AI beat, every day." tagline
}

export const BRAND_TAGLINE = 'Covering the AI beat, every day.'

export function BrandLockup({ sm = false, mono = false, tag = false }: Props) {
  const showTag = tag && !sm
  return (
    <span className={'lb' + (mono ? ' mono' : '') + (sm ? ' sm' : '')}>
      <span className="lb-lockup">
        <span className="lb-mark eq" aria-hidden="true">
          <i /><i /><i /><i /><i />
        </span>
        <span className="lb-word">
          <span className="lb-name">Model<span className="beat">Beat</span></span>
          {showTag && <span className="lb-tag">{BRAND_TAGLINE}</span>}
        </span>
      </span>
    </span>
  )
}
