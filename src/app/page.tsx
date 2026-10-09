import { Container, Stack, Title } from "@mantine/core";
import ManualLocation from "@/components/ManualLocation";
import UserLocation from "@/components/UserLocation";
import VehicleSelect from "@/components/VehicleSelect";

export default function Home() {
  return (
    <Container size="sm" py="xl">
      <Title order={1} mb="md">
        Fuel Route
      </Title>
      <Stack gap="xl">
        <UserLocation />
        <ManualLocation />
        <VehicleSelect />
      </Stack>
    </Container>
  );
}
