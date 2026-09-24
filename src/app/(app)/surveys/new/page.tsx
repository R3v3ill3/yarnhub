import { redirect } from "next/navigation";

export default function NewSurveyPage() {
  redirect("/sms/new?kind=survey");
}
