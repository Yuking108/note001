import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { Browser } from '@/components/Browser';
import { allLabels, findLabel } from '@/lib/content';

type Params = { path: string[] };

/** レジストリと索引にある全ラベルパス分の静的ページを用意する（URL でブックマークできるように） */
export function generateStaticParams(): Params[] {
  return allLabels.map((label) => ({ path: label.path.split('/') }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { path } = await params;
  const labelPath = path.map(decodeURIComponent).join('/');
  return { title: `${labelPath} — note001` };
}

export default async function LabelPage({ params }: { params: Promise<Params> }) {
  const { path } = await params;
  const labelPath = path.map(decodeURIComponent).join('/');

  const label = findLabel(labelPath);
  if (label === undefined) notFound();

  return <Browser baseLabel={label.path} />;
}
