import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SiteSetting } from '../../database/entities/site-setting.entity';
import { UpdateSettingsDto } from './dto/update-settings.dto';

const SETTINGS_ID = 1;

@Injectable()
export class SettingsService {
  constructor(
    @InjectRepository(SiteSetting)
    private readonly settingsRepo: Repository<SiteSetting>,
  ) {}

  async get(): Promise<SiteSetting> {
    let settings = await this.settingsRepo.findOne({
      where: { id: SETTINGS_ID },
    });
    if (!settings) {
      settings = await this.settingsRepo.save(
        this.settingsRepo.create({ id: SETTINGS_ID }),
      );
    }
    return settings;
  }

  async update(dto: UpdateSettingsDto): Promise<SiteSetting> {
    const settings = await this.get();
    Object.assign(settings, dto);
    return this.settingsRepo.save(settings);
  }
}
