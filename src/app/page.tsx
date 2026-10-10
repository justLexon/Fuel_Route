import { Container, Stack, Title } from "@mantine/core";
import LocationSection from "@/components/LocationSection";
import VehiclePicker from "@/components/VehiclePicker";

export default function Home() {
  return (
    <Container size="sm" py="xl">
      <Title order={1} mb="md">
        Fuel Route
      </Title>
      <Stack gap="xl">
        <VehiclePicker />
        <LocationSection />
      </Stack>
    </Container>
  );
}
