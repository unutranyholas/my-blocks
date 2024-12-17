import type { Meta, StoryObj } from '@storybook/react';
import { Recorder } from '../machines/recorder/recorder';

const meta = {
  title: 'Recorder',
  component: Recorder,
  parameters: {
    layout: 'centered',
  },
  tags: ['autodocs'],
} satisfies Meta<typeof Recorder>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};