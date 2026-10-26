<script setup lang="ts">
const props = defineProps<{
  label?: string
  error?: string
}>()

const uid = useId()
const controlId = `${uid}-champ`
const errorId = `${uid}-erreur`

// Fournis au champ via le slot : `v-slot="{ id, invalid, describedby }"`.
const invalid = computed(() => Boolean(props.error))
const describedby = computed(() => (props.error ? errorId : undefined))
</script>

<template>
  <div class="champ">
    <label v-if="label" class="champ-label" :for="controlId">{{ label }}</label>
    <slot :id="controlId" :invalid="invalid" :describedby="describedby" />
    <p v-if="error" :id="errorId" class="message-erreur" role="alert">
      <PhosphorIcon name="warning-circle" size="1.25rem" aria-hidden="true" />
      <span>{{ error }}</span>
    </p>
  </div>
</template>
