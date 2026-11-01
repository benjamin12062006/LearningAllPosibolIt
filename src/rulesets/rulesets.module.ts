import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { PrismaModule } from '../database/prisma.module.js';
import { ProjectsModule } from '../projects/projects.module.js';
import { UsersModule } from '../users/users.module.js';
import { RulesetsController } from './rulesets.controller.js';
import { RulesetsRepository } from './rulesets.repository.js';
import { RulesetsService } from './rulesets.service.js';

@Module({
  imports: [AuthModule, PrismaModule, ProjectsModule, UsersModule],
  controllers: [RulesetsController],
  providers: [RulesetsRepository, RulesetsService],
  exports: [RulesetsService],
})
export class RulesetsModule {}
