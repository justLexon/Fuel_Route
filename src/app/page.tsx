import { Container, Text, Title } from "@mantine/core";

export default function Home() {
  return (
    <Container size="sm" py="xl">
      <Title order={1}>Fuel Route</Title>
      <Text c="dimmed">
        Find nearby gas stations with the right fuel for your vehicle.
      </Text>
    </Container>
  );
}
