import { redirect } from "next/navigation";

export default function NewBlastPage() {
  redirect("/sms/new?kind=blast");
}
