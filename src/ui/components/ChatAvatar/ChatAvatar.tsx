import { Avatar } from '@maxhub/max-ui'
import { avatarGradient, initials } from '../../lib/format'

export function ChatAvatar({ chatId, title, size = 64 }: { chatId: string; title: string; size?: number }) {
  return (
    <Avatar.Container size={size} form="circle">
      <Avatar.Text gradient={avatarGradient(chatId)}>{initials(title)}</Avatar.Text>
    </Avatar.Container>
  )
}
