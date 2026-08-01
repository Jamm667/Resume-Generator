import { BankView } from "@/components/bank/bank-view";
import { getBankForUser } from "@/lib/queries/bank";
import { requireUser } from "@/lib/require-user";

export default async function BankPage() {
  const user = await requireUser();
  const bank = await getBankForUser(user.id);

  return (
    <main className="mx-auto max-w-4xl p-8">
      <h1 className="text-xl font-semibold">Data bank</h1>
      <p className="mt-1 text-sm text-slate-600">
        Everything pulled out of your resumes. Every tailored resume is built
        from these entries, so corrections here reach all of them.
      </p>

      <div className="mt-6">
        <BankView initialBank={bank} />
      </div>
    </main>
  );
}
