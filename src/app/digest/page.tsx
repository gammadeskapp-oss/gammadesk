import { redirect } from 'next/navigation';

/**
 * The digest is now the top half of `/daily`.
 *
 * Kept as a redirect rather than deleted: this route has been linked from the
 * dashboard, the guide, and anywhere anyone has bookmarked it.
 */
export default function DigestPage(): never {
  redirect('/daily');
}
