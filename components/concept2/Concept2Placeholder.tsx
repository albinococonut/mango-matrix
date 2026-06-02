import { INK2, LINE } from './kit';

// Temporary "being rebuilt" panel shown on concept2 routes whose luxury
// build hasn't landed yet. Replaced page-by-page.
export default function Concept2Placeholder({ label }: { label: string }) {
  return (
    <div className="rounded-[26px] border c2ui text-center" style={{ padding: '64px 32px', color: INK2, background: 'linear-gradient(180deg, rgba(255,255,255,0.78), rgba(255,255,255,0.58))', borderColor: 'rgba(255,255,255,0.75)', boxShadow: '0 18px 48px -28px rgba(40,34,26,0.30)' }}>
      <div className="c2disp" style={{ fontSize: 22, color: '#22201C' }}>{label}</div>
      <div className="mt-2 text-[13px]" style={{ borderTop: 'none' }}>Being rebuilt in the concept 2 design — coming shortly.</div>
      <div className="mt-1 text-[13px]" style={{ color: 'rgba(34,32,28,0.45)' }}>The live production version is unchanged and still available.</div>
    </div>
  );
}
