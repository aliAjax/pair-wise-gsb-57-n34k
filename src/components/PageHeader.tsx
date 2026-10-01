import type { ReactNode } from 'react'
import { Box, HStack, Heading, Text } from '@chakra-ui/react'

interface Props {
  title: string
  description: string
  actions?: ReactNode
}

export function PageHeader({ title, description, actions }: Props) {
  return (
    <Box className="page-heading">
      <Box>
        <Heading size="md">{title}</Heading>
        <Text mt="2" color="gray.600" fontSize="sm">
          {description}
        </Text>
      </Box>
      {actions ? <HStack spacing="10px">{actions}</HStack> : null}
    </Box>
  )
}
