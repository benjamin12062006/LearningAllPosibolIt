import {
  ArgsType,
  Field,
  ID,
  InputType,
  Int,
  ObjectType,
  registerEnumType,
} from '@nestjs/graphql';
import {
  AppendConversationMessageDto,
  ConversationListQueryDto,
  ConversationMessagesQueryDto,
  CreateConversationDto,
} from '../../conversations/conversations.dto.js';

enum ConversationVisibility {
  private = 'private',
}

enum ConversationStatus {
  active = 'active',
}

enum ConversationMessageRole {
  user = 'user',
  assistant = 'assistant',
}

registerEnumType(ConversationVisibility, { name: 'ConversationVisibility' });
registerEnumType(ConversationStatus, { name: 'ConversationStatus' });
registerEnumType(ConversationMessageRole, { name: 'ConversationMessageRole' });

@ObjectType('Conversation')
export class ConversationType {
  @Field(() => ID) id!: string;
  @Field(() => ID) organizationId!: string;
  @Field(() => ID) projectId!: string;
  @Field(() => ID) workbookId!: string;
  @Field(() => ID, { nullable: true }) worksheetId!: string | null;
  @Field(() => ID) createdBy!: string;
  @Field() title!: string;
  @Field(() => ConversationVisibility) visibility!: 'private';
  @Field(() => ConversationStatus) status!: 'active';
  @Field() createdAt!: string;
  @Field() updatedAt!: string;
}

@ObjectType('ConversationPage')
export class ConversationPageType {
  @Field(() => [ConversationType]) items!: ConversationType[];
  @Field(() => String, { nullable: true }) nextCursor!: string | null;
}

@ObjectType('ConversationMessage')
export class ConversationMessageType {
  @Field(() => ID) id!: string;
  @Field(() => ID) conversationId!: string;
  @Field(() => ID, { nullable: true }) authorId!: string | null;
  @Field(() => ID, { nullable: true }) clientMessageId!: string | null;
  @Field(() => ConversationMessageRole) role!: 'user' | 'assistant';
  @Field(() => Int) sequence!: number;
  @Field() content!: string;
  @Field() createdAt!: string;
}

@ObjectType('ConversationMessagePage')
export class ConversationMessagePageType {
  @Field(() => [ConversationMessageType]) items!: ConversationMessageType[];
  @Field(() => String, { nullable: true }) nextCursor!: string | null;
}

@ArgsType()
export class ConversationListArgs extends ConversationListQueryDto {
  @Field(() => ID, { nullable: true }) declare workbookId?: string;
  @Field(() => ID, { nullable: true }) declare worksheetId?: string;
  @Field(() => Int, { nullable: true }) declare limit?: number;
  @Field(() => String, { nullable: true }) declare cursor?: string;
}

@ArgsType()
export class ConversationMessagesArgs extends ConversationMessagesQueryDto {
  @Field(() => Int, { nullable: true }) declare limit?: number;
  @Field(() => String, { nullable: true }) declare cursor?: string;
}

@InputType('CreateConversationInput')
export class CreateConversationInput extends CreateConversationDto {
  @Field() declare title: string;
}

@InputType('AppendConversationMessageInput')
export class AppendConversationMessageInput extends AppendConversationMessageDto {
  @Field(() => ID) declare clientMessageId: string;
  @Field() declare content: string;
}
