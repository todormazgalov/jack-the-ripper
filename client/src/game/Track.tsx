import { SLOT_COUNT, slotLabel, type GameView } from '@jtr/shared';

const slots = Array.from({ length: SLOT_COUNT }, (_, i) => i);

/** The move track at the bottom of the board: I..V then 1..15. */
export function MoveTrack({ view }: { view: GameView }) {
  const row = view.sheet?.[view.night - 1];
  const special = (i: number) => view.specials.find((s) => s.slot === i || (s.kind === 'coach' && s.slot + 1 === i));
  return (
    <div className="track">
      {slots.map((i) => {
        const sp = special(i);
        const cls = [
          'slot',
          i < 5 ? 'roman' : '',
          view.timeOfCrime === i ? 'crime' : '',
          view.track === i ? 'jack' : '',
          view.track !== null && i < view.track ? 'past' : '',
          sp ? sp.kind : '',
        ].join(' ');
        return (
          <div key={i} className={cls} title={sp ? `${sp.kind} used` : undefined}>
            <span className="label">{slotLabel(i)}</span>
            {row?.[i] != null && <span className="num">{row[i]}</span>}
            {sp && <span className="sp">{sp.kind === 'coach' ? '🐎' : '⇄'}</span>}
          </div>
        );
      })}
    </div>
  );
}

/** Jack's secret move track sheet: one row per night. */
export function JackSheet({ view }: { view: GameView }) {
  return (
    <div className="sheet">
      <div className="sheet-head">Move track sheet · hideout <span className="oval">{view.hideout ?? '?'}</span></div>
      <table>
        <tbody>
          {view.sheet!.map((row, n) => (
            <tr key={n} className={n + 1 === view.night ? 'now' : ''}>
              <th>{n + 1}</th>
              {row.map((v, i) => <td key={i} className={i < 5 ? 'roman' : ''}>{v ?? ''}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
