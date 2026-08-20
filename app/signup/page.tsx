import { AuthPageShell } from "@/components/auth/AuthPageShell";
import { ClientOnlyAuthPage } from "@/components/auth/ClientOnlyAuthPage";
import { AuthV4 } from "@/components/core-app/screens/AuthV4";



export const dynamic = "force-dynamic";

/*
 * ⚠ CUTOVER: AuthV4 replaced the previous SignupContent here.
 *
 * The auth WORKFLOW is unchanged and was NOT rewired — AuthV4 calls the same
 * next-auth `signIn('credentials')` and the same POST /api/auth/register that
 * SignupContent already used, and resolves provider availability through the same
 * isSocialProviderEnabled. It is a new presentation of the existing flow, verified
 * end to end in a browser: duplicate email surfaces the server's own error, a new
 * account is created and auto-signed-in, a wrong password returns the shared
 * message, and a correct one lands on /dashboard.
 *
 * The shells (AuthPageShell / ClientOnlyAuthPage) are kept because they carry the
 * page chrome and the client-only boundary. One-line rollback: restore the
 * SignupContent import and element.
 *
 * ⚠ THIS COMMENT LIVES ABOVE THE COMPONENT, NOT INSIDE THE JSX, AND MUST STAY
 * THERE. It previously sat between the AuthPageShell and AuthV4 elements as a
 * bare block comment. In JSX children position that is not a comment at all —
 * it is literal text, so the whole block rendered as visible copy at the top of
 * the production sign-up page. Commenting inside JSX requires wrapping the
 * block in braces; keeping it out here avoids the question entirely.
 */
export default function SignupPage() {
  return (
    <ClientOnlyAuthPage>
      <AuthPageShell>
        <AuthV4 mode="signup" />
      </AuthPageShell>
    </ClientOnlyAuthPage>
  );
}
