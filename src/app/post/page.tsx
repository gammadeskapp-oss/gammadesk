import { redirect } from 'next/navigation';

/**
 * The morning post is now the bottom half of `/daily`.
 *
 * Kept as a redirect rather than deleted, so links that already point here —
 * including any sent out with a post — keep landing on the text they meant.
 */
export default function PostPage(): never {
  redirect('/daily');
}
