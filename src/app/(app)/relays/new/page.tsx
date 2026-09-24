import { redirect } from "next/navigation";

export default function NewRelayPage() {
  redirect("/sms/new?kind=relay");
}