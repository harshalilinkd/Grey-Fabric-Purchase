import { redirect } from "next/navigation";

/** Program Cards is now part of the Dyeing Queue (create + view programs there). */
export default function ProgramCardsPage() {
  redirect("/dyeing-queue");
}
