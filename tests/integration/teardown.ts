import { IntegrationController } from "./IntegrationController";

export default async function teardown(): Promise<void> {
  if (process.env["CI"]) await IntegrationController.dropDatabase();
}
