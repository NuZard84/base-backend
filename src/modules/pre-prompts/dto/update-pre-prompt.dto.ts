import { PartialType } from '@nestjs/swagger';
import { CreatePrePromptDto } from './create-pre-prompt.dto';

export class UpdatePrePromptDto extends PartialType(CreatePrePromptDto) {}
