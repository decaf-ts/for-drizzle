import { IntegrationController } from "./IntegrationController";

export default async function setup(): Promise<void> {
  if (process.env["CI"]) await IntegrationController.setupDatabase();
}
