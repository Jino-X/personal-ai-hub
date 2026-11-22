import { registerSystemJobs } from "../jobs/system";
import { registerProductivityAgent } from "./productivity";
import { registerCalendarSync } from "./productivity/google-calendar";
import { registerResearchAgent } from "./research";
import { registerAINewsAgent } from "./ai-news";
import { registerDeveloperAgent } from "./developer";
import { registerWatchlistAgent } from "./watchlist";
import { registerKnowledgeAgent } from "./knowledge";
import { registerBriefingAgent } from "./briefing";

/**
 * Registers every agent's job handlers and schedules.
 * Agents are plain modules with clear responsibilities that communicate through
 * the database and the durable job queue — no heavyweight multi-agent framework.
 */
export function registerAgents() {
  registerSystemJobs();
  registerProductivityAgent();
  registerCalendarSync();
  registerResearchAgent();
  registerAINewsAgent();
  registerDeveloperAgent();
  registerWatchlistAgent();
  registerKnowledgeAgent();
  registerBriefingAgent();
}
