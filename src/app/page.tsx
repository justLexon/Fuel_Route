import DashboardHeader from "@/components/DashboardHeader";
import LocationSection from "@/components/LocationSection";
import VehiclePicker from "@/components/VehiclePicker";
import styles from "@/components/Dashboard.module.css";

export default function Home() {
  return (
    <main className={styles.dashboard}>
      <div className={styles.shell}>
        <DashboardHeader />
        <LocationSection vehiclePanel={<VehiclePicker />} />
      </div>
    </main>
  );
}
