import { IsString, IsNotEmpty } from 'class-validator';

export class UpdateNameDto {
  @IsString()
  @IsNotEmpty()
  name: string;
}
