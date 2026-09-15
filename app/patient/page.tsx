import { RoleNav } from "@/components/ui";
import { PatientView } from "@/components/PatientView";

export default function PatientPage() {
  return (
    <>
      <RoleNav role="patient" />
      <PatientView />
    </>
  );
}
