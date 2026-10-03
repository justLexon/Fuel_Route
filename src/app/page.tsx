import { Container, Title } from "@mantine/core";
import UserLocation from "@/components/UserLocation";

export default function Home() {
  return (
    <Container size="sm" py="xl">
      <Title order={1} mb="md">
        Fuel Route
      </Title>
      <UserLocation />
    </Container>
  );
}
